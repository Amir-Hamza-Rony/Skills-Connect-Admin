import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";

import { POST as createInvoice } from "@/app/api/invoices/route";
import { POST as voidInvoice } from "@/app/api/invoices/[id]/void/route";
import {
  GET as getSyncState,
  POST as syncInvoice,
} from "@/app/api/invoices/[id]/sync/route";
import { getDb } from "@/lib/db";
import {
  registerInvoiceProvider,
  resetInvoiceProvidersForTests,
} from "@/lib/invoice-integration";
import type { InvoiceSyncInput } from "@/lib/invoice-integration";

import { authedRequest, clearDb, seedOrder } from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

const lineItem = {
  id: "line-1",
  description: "Tuition",
  amount: 1000,
  currency: "AUD",
  quantity: 1,
  taxAmount: 0,
  taxRate: 0,
};

async function createAudInvoice(orderId: ObjectId) {
  const res = await createInvoice(
    authedRequest("POST", "/api/invoices", {
      orderId: String(orderId),
      currency: "AUD",
      issueDate: "2027-02-01",
      dueDate: "2027-03-01",
      lineItems: [lineItem],
    }),
  );
  expect(res.status).toBe(201);
  return (await json(res)).invoice as any;
}

function syncRequest(invoiceId: string) {
  return syncInvoice(
    authedRequest("POST", `/api/invoices/${invoiceId}/sync`),
    { params: { id: invoiceId } },
  );
}

const ENV_KEYS = [
  "INVOICE_INTEGRATION_ENABLED",
  "INVOICE_INTEGRATION_PROVIDER",
  "INVOICE_INTEGRATION_BASE_URL",
  "INVOICE_INTEGRATION_API_KEY",
  "INVOICE_INTEGRATION_TIMEOUT_MS",
] as const;

describe("Phase 5 — provider-independent invoice integration", () => {
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    await clearDb();
    resetInvoiceProvidersForTests();
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    resetInvoiceProvidersForTests();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("keeps internal invoices working and fails closed while integration is disabled", async () => {
    const orderId = await seedOrder();
    const invoice = await createAudInvoice(orderId);
    expect(invoice.external).toMatchObject({ status: "Not Synced", attempts: 0 });

    const res = await syncRequest(invoice.id);
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("INTEGRATION_DISABLED");

    const db = await getDb();
    const stored = await db
      .collection("invoices")
      .findOne({ _id: new ObjectId(invoice.id) });
    expect(stored?.external?.status).toBe("Not Synced");
    expect(stored?.external?.attempts).toBe(0);
  });

  it("fails closed when a provider name is configured but no adapter is registered", async () => {
    process.env.INVOICE_INTEGRATION_ENABLED = "true";
    process.env.INVOICE_INTEGRATION_PROVIDER = "not-registered";

    const orderId = await seedOrder();
    const invoice = await createAudInvoice(orderId);

    const res = await syncRequest(invoice.id);
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("PROVIDER_NOT_REGISTERED");
  });

  it("maps the invoice, persists the external id and prevents duplicate sends", async () => {
    const calls: InvoiceSyncInput[] = [];
    registerInvoiceProvider("fake", () => ({
      name: "fake",
      async syncInvoice(input) {
        calls.push(input);
        return { externalInvoiceId: "EXT-123" };
      },
    }));
    process.env.INVOICE_INTEGRATION_ENABLED = "true";
    process.env.INVOICE_INTEGRATION_PROVIDER = "fake";

    const orderId = await seedOrder();
    const invoice = await createAudInvoice(orderId);

    const res = await syncRequest(invoice.id);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.invoice.external).toMatchObject({
      status: "Synced",
      provider: "fake",
      externalInvoiceId: "EXT-123",
      attempts: 1,
      lastError: null,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      idempotencyKey: `invoice-sync:${invoice.id}`,
      localInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currency: "AUD",
      total: 1000,
      issueDate: "2027-02-01T00:00:00.000Z",
      dueDate: "2027-03-01T00:00:00.000Z",
      status: "Draft",
      orderId: String(orderId),
    });
    expect(calls[0].lineItems).toEqual([
      {
        id: "line-1",
        description: "Tuition",
        amount: 1000,
        quantity: 1,
        taxAmount: 0,
        taxRate: 0,
        currency: "AUD",
      },
    ]);

    // Duplicate prevention: a synced invoice is never re-sent.
    const again = await syncRequest(invoice.id);
    expect(again.status).toBe(200);
    expect((await json(again)).invoice.external.externalInvoiceId).toBe("EXT-123");
    expect(calls).toHaveLength(1);
  });

  it("records a failed attempt safely and allows a retry with the same idempotency key", async () => {
    const keys: string[] = [];
    let attempt = 0;
    registerInvoiceProvider("fake", () => ({
      name: "fake",
      async syncInvoice(input) {
        keys.push(input.idempotencyKey);
        attempt += 1;
        if (attempt === 1) throw new Error("provider unavailable");
        return { externalInvoiceId: "EXT-RETRY" };
      },
    }));
    process.env.INVOICE_INTEGRATION_ENABLED = "true";
    process.env.INVOICE_INTEGRATION_PROVIDER = "fake";

    const orderId = await seedOrder();
    const invoice = await createAudInvoice(orderId);

    const first = await syncRequest(invoice.id);
    expect(first.status).toBe(502);
    expect((await json(first)).error.code).toBe("PROVIDER_ERROR");

    const db = await getDb();
    let stored = await db
      .collection("invoices")
      .findOne({ _id: new ObjectId(invoice.id) });
    expect(stored?.external?.status).toBe("Failed");
    expect(stored?.external?.attempts).toBe(1);
    expect(stored?.external?.lastError).toMatchObject({
      code: "PROVIDER_ERROR",
      message: "provider unavailable",
    });

    const retry = await syncRequest(invoice.id);
    expect(retry.status).toBe(200);
    stored = await db
      .collection("invoices")
      .findOne({ _id: new ObjectId(invoice.id) });
    expect(stored?.external?.status).toBe("Synced");
    expect(stored?.external?.attempts).toBe(2);
    expect(stored?.external?.externalInvoiceId).toBe("EXT-RETRY");
    expect(keys).toEqual([
      `invoice-sync:${invoice.id}`,
      `invoice-sync:${invoice.id}`,
    ]);

    const attempts = await db.collection("invoice_sync_attempts").countDocuments({});
    expect(attempts).toBe(2);
  });

  it("never sends a void invoice to the provider", async () => {
    let calls = 0;
    registerInvoiceProvider("fake", () => ({
      name: "fake",
      async syncInvoice() {
        calls += 1;
        return { externalInvoiceId: "SHOULD-NOT-HAPPEN" };
      },
    }));
    process.env.INVOICE_INTEGRATION_ENABLED = "true";
    process.env.INVOICE_INTEGRATION_PROVIDER = "fake";

    const orderId = await seedOrder();
    const invoice = await createAudInvoice(orderId);
    const voided = await voidInvoice(
      authedRequest("POST", `/api/invoices/${invoice.id}/void`),
      { params: { id: invoice.id } },
    );
    expect(voided.status).toBe(200);

    const res = await syncRequest(invoice.id);
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("INVOICE_VOID");
    expect(calls).toBe(0);
  });

  it("exposes the current sync state without calling the provider", async () => {
    let calls = 0;
    registerInvoiceProvider("fake", () => ({
      name: "fake",
      async syncInvoice() {
        calls += 1;
        return { externalInvoiceId: "EXT-1" };
      },
    }));

    const orderId = await seedOrder();
    const invoice = await createAudInvoice(orderId);

    const res = await getSyncState(
      authedRequest("GET", `/api/invoices/${invoice.id}/sync`),
      { params: { id: invoice.id } },
    );
    expect(res.status).toBe(200);
    expect((await json(res)).external).toMatchObject({
      status: "Not Synced",
      externalInvoiceId: null,
      attempts: 0,
    });
    expect(calls).toBe(0);
  });
});
