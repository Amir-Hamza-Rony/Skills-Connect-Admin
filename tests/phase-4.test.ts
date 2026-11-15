import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { POST as createOrder } from "@/app/api/orders/route";
import {
  POST as createInvoice,
  GET as listInvoices,
} from "@/app/api/invoices/route";
import { POST as recordPayment } from "@/app/api/payments/route";
import {
  POST as reversePaymentAllocation,
} from "@/app/api/payments/[id]/reverse-allocation/route";
import { GET as financeSummary } from "@/app/api/finance/summary/route";
import { GET as qbCallback } from "@/app/api/integrations/quickbooks/callback/route";
import { POST as qbWebhook } from "@/app/api/integrations/quickbooks/webhook/route";
import { GET as reconciliation } from "@/app/api/reconciliation/route";

import {
  authedRequest,
  clearDb,
  seedClient,
  seedQualification,
  seedRto,
  seedAgent,
  seedPriceCategory,
  seedPriceList,
  seedSupplierRoute,
  seedMapping,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

async function seedOrder() {
  const clientId = await seedClient();
  const qId = await seedQualification();
  const aId = await seedAgent();
  const rId = await seedRto();
  const cId = await seedPriceCategory();
  await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
  await seedSupplierRoute(qId, aId, rId, 1500);
  await seedMapping(qId, rId);

  const orderRes = await createOrder(
    authedRequest("POST", "/api/orders", {
      clientId: String(clientId),
      qualificationId: String(qId),
      salesAgentId: String(new ObjectId()),
      sourceAgentId: String(aId),
      rtoId: String(rId),
      sellingPrice: 5000,
    }),
  );
  const { order } = await json(orderRes);
  return { orderId: order.id };
}

async function seedInvoice(orderId: string, currency = "AUD", total = 5000) {
  const invRes = await createInvoice(
    authedRequest("POST", "/api/invoices", {
      orderId,
      currency,
      issueDate: "2027-02-01",
      dueDate: "2027-03-01",
      total,
    }),
  );
  const { invoice } = await json(invRes);
  return { invoiceId: invoice.id };
}

describe("Phase 4 — Invoice management", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates an invoice with currency and line items", async () => {
    const { orderId } = await seedOrder();

    const invRes = await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId,
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        total: 5000,
        lineItems: [
          {
            id: "line-1",
            description: "Tuition",
            amount: 5000,
            currency: "AUD",
            quantity: 1,
            taxAmount: 0,
            taxRate: 0,
          },
        ],
      }),
    );
    expect(invRes.status).toBe(201);
    const body = await json(invRes);
    expect(body.invoice.currency).toBe("AUD");
    expect(body.invoice.total).toBe(5000);
    expect(body.invoice.lineItems.length).toBe(1);
    expect(body.invoice.qbSyncStatus).toBe("Not Synced");
  });

  it("prevents duplicate active invoice per order", async () => {
    const { orderId } = await seedOrder();

    await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId,
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        total: 5500,
      }),
    );
    const dup = await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId,
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        total: 6000,
      }),
    );
    expect(dup.status).toBe(409);
  });

  it("lists invoices filtered by currency", async () => {
    const { orderId: orderIdA } = await seedOrder();
    const { orderId: orderIdB } = await seedOrder();

    await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: orderIdA,
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        total: 5500,
      }),
    );
    await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: orderIdB,
        currency: "BDT",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        total: 6000,
      }),
    );

    const listRes = await listInvoices(
      authedRequest("GET", "/api/invoices?currency=BDT"),
    );
    const list = await json(listRes);
    expect(list.invoices.length).toBe(1);
    expect(list.invoices[0].currency).toBe("BDT");
  });
});

describe("Phase 4 — Payment management", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("records a payment with currency and verification status", async () => {
    const { orderId } = await seedOrder();
    const { invoiceId } = await seedInvoice(orderId);

    const res = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId,
        invoiceId,
        amount: 2000,
        date: "2027-02-15",
        method: "Bank Transfer",
        reference: "REF-1",
        currency: "AUD",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.payment.currency).toBe("AUD");
    expect(body.payment.verificationStatus).toBe("Unverified");
  });

  it("prevents over-allocation against invoice", async () => {
    const { orderId } = await seedOrder();
    const { invoiceId } = await seedInvoice(orderId);

    await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId,
        invoiceId,
        amount: 5000,
        date: "2027-02-15",
        method: "Bank Transfer",
        reference: "REF-1",
        currency: "AUD",
      }),
    );

    const over = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId,
        invoiceId,
        amount: 1,
        date: "2027-02-16",
        method: "Bank Transfer",
        reference: "REF-2",
        currency: "AUD",
      }),
    );
    expect(over.status).toBe(400);
    expect((await json(over)).error.code).toBe("OVER_ALLOCATION");
  });

  it("reverses a payment allocation", async () => {
    const { orderId } = await seedOrder();
    const { invoiceId } = await seedInvoice(orderId);

    const payRes = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId,
        invoiceId,
        amount: 2000,
        date: "2027-02-15",
        method: "Bank Transfer",
        reference: "REF-1",
        currency: "AUD",
      }),
    );
    const { payment } = await json(payRes);

    const revRes = await reversePaymentAllocation(
      authedRequest("POST", `/api/payments/${payment.id}/reverse-allocation`),
      { params: { id: payment.id } },
    );
    expect(revRes.status).toBe(200);

    const list = await listInvoices(
      authedRequest("GET", `/api/invoices?orderId=${orderId}`),
    );
    const inv = (await json(list)).invoices[0];
    expect(inv.status).toBe("Draft");
  });
});

describe("Phase 4 — Finance summary multi-currency", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("returns per-currency breakdown", async () => {
    const { orderId: orderIdA } = await seedOrder();
    const { orderId: orderIdB } = await seedOrder();

    await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: orderIdA,
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        total: 5000,
        lineItems: [
          {
            id: "line-1",
            description: "Tuition",
            amount: 5000,
            currency: "AUD",
            quantity: 1,
            taxAmount: 0,
            taxRate: 0,
          },
        ],
      }),
    );
    await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: orderIdB,
        currency: "BDT",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        total: 6000,
        lineItems: [
          {
            id: "line-1",
            description: "Tuition",
            amount: 6000,
            currency: "BDT",
            quantity: 1,
            taxAmount: 0,
            taxRate: 0,
          },
        ],
      }),
    );

    const res = await financeSummary(
      authedRequest("GET", "/api/finance/summary"),
    );
    const body = await json(res);
    const aud = body.currencyBreakdown.find((c: any) => c.currency === "AUD");
    const bdt = body.currencyBreakdown.find((c: any) => c.currency === "BDT");
    expect(aud.invoiced).toBe(5000);
    expect(bdt.invoiced).toBe(6000);
    expect(body.outstanding).toBe(11000);
  });
});

describe("Phase 4 — QuickBooks callback state validation", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("rejects callback with mismatched state", async () => {
    const res = await qbCallback(
      authedRequest("GET", "/api/integrations/quickbooks/callback?code=abc&realmId=xyz&state=wrong-user"),
    );
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("STATE_MISMATCH");
  });

  it("rejects callback missing code", async () => {
    const res = await qbCallback(
      authedRequest("GET", "/api/integrations/quickbooks/callback?realmId=xyz&state=test-user-1"),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("INVALID_CALLBACK");
  });
});

describe("Phase 4 — Webhook signature validation", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("rejects webhook with invalid signature", async () => {
    const body = JSON.stringify({ eventNotifications: [] });
    const res = await qbWebhook(
      new Request("http://localhost/api/integrations/quickbooks/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "intuit-signature": "bad-signature",
        },
        body,
      }),
    );
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("INVALID_SIGNATURE");
  });
});

describe("Phase 4 — Reconciliation", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("lists reconciliation items", async () => {
    const res = await reconciliation(
      authedRequest("GET", "/api/reconciliation"),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.items)).toBe(true);
  });
});
