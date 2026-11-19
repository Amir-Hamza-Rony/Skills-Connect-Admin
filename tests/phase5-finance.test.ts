import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { POST as createInvoice } from "@/app/api/invoices/route";
import { PATCH as patchInvoice } from "@/app/api/invoices/[id]/route";
import { POST as voidInvoice } from "@/app/api/invoices/[id]/void/route";
import { POST as recordPayment } from "@/app/api/payments/route";
import { GET as financeSummary } from "@/app/api/finance/summary/route";
import { GET as financeReport } from "@/app/api/reports/finance/route";
import { GET as clientsReport } from "@/app/api/reports/clients/route";
import { GET as monthlySummaryReport } from "@/app/api/reports/monthly-summary/route";
import { GET as outstandingReport } from "@/app/api/reports/outstanding/route";
import { GET as ageingReport } from "@/app/api/reports/ageing/route";
import { extractRows } from "@/app/api/reports/[type]/export/route";
import { getDb } from "@/lib/db";
import { formatMoney, normalizeCurrency } from "@/lib/money-format";

import {
  authedRequest,
  clearDb,
  makeB2BAgentToken,
  makeBDCToken,
  makeSuperAdminToken,
  seedClient,
  seedOrder,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

const lineItem = (overrides: Record<string, unknown> = {}) => ({
  id: "line-1",
  description: "Tuition",
  amount: 1000,
  currency: "AUD",
  quantity: 1,
  taxAmount: 0,
  taxRate: 0,
  ...overrides,
});

async function createAudInvoice(orderId: string, lineItems?: unknown[]) {
  return createInvoice(
    authedRequest("POST", "/api/invoices", {
      orderId,
      currency: "AUD",
      issueDate: "2027-02-01",
      dueDate: "2027-03-01",
      ...(lineItems ? { lineItems } : {}),
    }),
  );
}

describe("Phase 5 — finance integrity", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("rejects allocating a payment to a void invoice without resurrecting it", async () => {
    const orderId = await seedOrder();
    const created = await createAudInvoice(orderId, [lineItem()]);
    const invoiceId = (await json(created)).invoice.id;

    const voided = await voidInvoice(
      authedRequest("POST", `/api/invoices/${invoiceId}/void`),
      { params: { id: invoiceId } },
    );
    expect(voided.status).toBe(200);

    const payment = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId,
        amount: 1000,
        date: "2027-02-15",
        method: "Bank Transfer",
        currency: "AUD",
      }),
    );
    expect(payment.status).toBe(400);
    expect((await json(payment)).error.code).toBe("INVOICE_VOID");

    const db = await getDb();
    const stored = await db
      .collection("invoices")
      .findOne({ _id: new (await import("mongodb")).ObjectId(invoiceId) });
    expect(stored?.status).toBe("Void");

    const payments = await db.collection("payments").countDocuments({ invoiceId: new (await import("mongodb")).ObjectId(invoiceId) });
    expect(payments).toBe(0);
  });

  it("rejects a payment whose currency differs from the invoice", async () => {
    const orderId = await seedOrder();
    const created = await createAudInvoice(orderId, [lineItem()]);
    const invoiceId = (await json(created)).invoice.id;

    const payment = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId,
        amount: 1000,
        date: "2027-02-15",
        method: "Bank Transfer",
        currency: "BDT",
      }),
    );
    expect(payment.status).toBe(400);
    expect((await json(payment)).error.code).toBe("CURRENCY_MISMATCH");
  });

  it("rejects invalid invoice line items", async () => {
    const orderId = await seedOrder();

    const negative = await createAudInvoice(orderId, [lineItem({ amount: -1 })]);
    expect(negative.status).toBe(400);
    expect((await json(negative)).error.code).toBe("INVALID_LINE_ITEM");

    const notANumber = await createAudInvoice(orderId, [lineItem({ amount: "1000" })]);
    expect(notANumber.status).toBe(400);

    const wrongCurrency = await createAudInvoice(orderId, [lineItem({ currency: "BDT" })]);
    expect(wrongCurrency.status).toBe(400);
    expect((await json(wrongCurrency)).error.code).toBe("CURRENCY_MISMATCH");
  });

  it("does not allow payment-derived or void status through invoice PATCH", async () => {
    const orderId = await seedOrder();
    const created = await createAudInvoice(orderId, [lineItem()]);
    const invoiceId = (await json(created)).invoice.id;

    const bypass = await patchInvoice(
      authedRequest("PATCH", `/api/invoices/${invoiceId}`, { status: "Void" }),
      { params: { id: invoiceId } },
    );
    expect(bypass.status).toBe(400);
    expect((await json(bypass)).error.code).toBe("INVALID_STATUS");

    const db = await getDb();
    const stored = await db
      .collection("invoices")
      .findOne({ _id: new (await import("mongodb")).ObjectId(invoiceId) });
    expect(stored?.status).toBe("Draft");
  });

  it("reports unallocated receipts separately and consistently across finance endpoints", async () => {
    const clientId = await seedClient(new ObjectId(), "Receipts Client");
    const orderId = await seedOrder(
      new ObjectId(),
      clientId,
      undefined,
      undefined,
      undefined,
      undefined,
      { currency: "AUD" },
    );
    const created = await createAudInvoice(String(orderId), [lineItem({ amount: 1000 })]);
    const invoiceId = (await json(created)).invoice.id;

    const allocated = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId,
        amount: 400,
        date: "2027-02-15",
        method: "Bank Transfer",
        currency: "AUD",
      }),
    );
    expect(allocated.status).toBe(201);

    const unallocated = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId: null,
        amount: 250,
        date: "2027-02-16",
        method: "Cash",
        currency: "AUD",
      }),
    );
    expect(unallocated.status).toBe(201);
    expect((await json(unallocated)).payment.allocatedAmount).toBe(250);

    const summary = await json(
      await financeSummary(
        authedRequest("GET", `/api/finance/summary?orderId=${String(orderId)}`),
      ),
    );
    expect(summary.collected).toBe(400);
    expect(summary.unallocated).toBe(250);
    expect(summary.invoiced).toBe(1000);
    expect(summary.outstanding).toBe(600);

    const finance = await json(
      await financeReport(authedRequest("GET", "/api/reports/finance")),
    );
    expect(finance.collected).toBe(400);
    expect(finance.unallocated).toBe(250);
    expect(finance.byCurrency.AUD.collected).toBe(400);
    expect(finance.byCurrency.AUD.unallocated).toBe(250);

    const clients = await json(
      await clientsReport(authedRequest("GET", "/api/reports/clients")),
    );
    const row = clients.clients.find((c: any) => c.id === String(clientId));
    expect(row.byCurrency.AUD.collected).toBe(400);
    expect(row.byCurrency.AUD.unallocated).toBe(250);
    expect(row.byCurrency.AUD.outstanding).toBe(600);
  });
});

describe("Phase 5 — finance scoping and masking", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("masks outstanding and ageing amounts from B2B_AGENT", async () => {
    const clientId = await seedClient(new ObjectId(), "Masked Client");
    const orderId = await seedOrder(new ObjectId(), clientId, undefined, undefined, undefined, undefined, {
      b2b_agent_id: "test-b2b-1",
      currency: "AUD",
    });
    const created = await createAudInvoice(String(orderId), [lineItem()]);
    const invoiceId = (await json(created)).invoice.id;
    const db = await getDb();
    await db.collection("invoices").updateOne(
      { _id: new ObjectId(invoiceId) },
      { $set: { status: "Overdue", dueDate: new Date("2027-01-01") } },
    );

    // A separate receipt must be masked too, not merely omitted by accident.
    await db.collection("payments").insertOne({
      orderId,
      invoiceId: null,
      amount: 50,
      allocatedAmount: 50,
      currency: "AUD",
      status: "Unallocated",
      date: new Date(),
    });

    const token = makeB2BAgentToken("test-b2b-1");
    const outstanding = await outstandingReport(
      authedRequest("GET", "/api/reports/outstanding", undefined, token),
    );
    const outstandingBody = await json(outstanding);
    expect(outstandingBody).not.toHaveProperty("totalOutstanding");
    expect(outstandingBody).not.toHaveProperty("totalOverdue");
    for (const bucket of outstandingBody.buckets) {
      expect(bucket).not.toHaveProperty("amount");
    }
    for (const customer of outstandingBody.customers) {
      expect(customer).not.toHaveProperty("totalOutstanding");
      expect(customer).not.toHaveProperty("overdue");
    }

    const ageing = await ageingReport(
      authedRequest("GET", "/api/reports/ageing", undefined, token),
    );
    const ageingBody = await json(ageing);
    expect(ageingBody).not.toHaveProperty("totalOverdue");
    for (const bucket of ageingBody.buckets) {
      expect(bucket).not.toHaveProperty("amount");
      for (const values of Object.values(bucket.byCurrency ?? {}) as Record<string, unknown>[]) {
        expect(values).not.toHaveProperty("overdue");
      }
    }

    const finance = await json(
      await financeReport(authedRequest("GET", "/api/reports/finance", undefined, token)),
    );
    expect(finance).not.toHaveProperty("unallocated");
    for (const values of Object.values(finance.byCurrency ?? {}) as Record<string, unknown>[]) {
      expect(values).not.toHaveProperty("unallocated");
    }
  });

  it("scopes finance and monthly-summary aggregates to accessible orders", async () => {
    const clientId = await seedClient(new ObjectId(), "Scoped Client");
    const ownedOrder = await seedOrder(new ObjectId(), clientId, undefined, undefined, undefined, undefined, {
      bdc_id: "test-bdc-scope",
      currency: "AUD",
      createdAt: new Date("2027-01-10"),
    });
    const otherOrder = await seedOrder(new ObjectId(), clientId, undefined, undefined, undefined, undefined, {
      bdc_id: "someone-else",
      currency: "AUD",
      createdAt: new Date("2027-01-10"),
    });

    await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: String(ownedOrder),
        currency: "AUD",
        issueDate: "2027-01-10",
        dueDate: "2027-02-10",
        lineItems: [lineItem({ amount: 1000 })],
      }),
    );
    await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: String(otherOrder),
        currency: "AUD",
        issueDate: "2027-01-10",
        dueDate: "2027-02-10",
        lineItems: [lineItem({ amount: 7000 })],
      }),
    );

    const token = makeBDCToken("test-bdc-scope");
    const finance = await financeReport(
      authedRequest("GET", "/api/reports/finance", undefined, token),
    );
    const financeBody = await json(finance);
    expect(financeBody.invoiced).toBe(1000);
    expect(financeBody.orders).toBe(1);

    const monthly = await monthlySummaryReport(
      authedRequest("GET", "/api/reports/monthly-summary", undefined, token),
    );
    const monthlyBody = await json(monthly);
    const totalInvoiced = monthlyBody.monthlySummary.reduce(
      (sum: number, row: any) => sum + (row.byCurrency.AUD?.invoiced ?? 0),
      0,
    );
    expect(totalInvoiced).toBe(1000);
  });

  it("returns unavailable totals when outstanding mixes currencies", async () => {
    const clientId = await seedClient(new ObjectId(), "Mixed Client");
    for (const currency of ["AUD", "BDT"]) {
      const orderId = await seedOrder(new ObjectId(), clientId, undefined, undefined, undefined, undefined, {
        currency,
      });
      await createInvoice(
        authedRequest("POST", "/api/invoices", {
          orderId: String(orderId),
          currency,
          issueDate: "2027-01-10",
          dueDate: "2027-02-10",
          lineItems: [lineItem({ amount: 1000, currency })],
        }),
      );
    }

    const res = await outstandingReport(
      authedRequest("GET", "/api/reports/outstanding", undefined, makeSuperAdminToken()),
    );
    const body = await json(res);
    expect(body.mixedCurrency).toBe(true);
    expect(body.totalOutstanding).toBeNull();
    expect(body.totalOverdue).toBeNull();
    for (const bucket of body.buckets) expect(bucket.amount).toBeNull();
    for (const customer of body.customers) {
      expect(customer.mixedCurrency).toBe(true);
      expect(customer.totalOutstanding).toBeNull();
    }
  });

  it("extracts only array rows and per-currency rows for export", () => {
    expect(extractRows({ clients: 3, byCurrency: { AUD: { invoiced: 10 } } })).toEqual([
      { currency: "AUD", invoiced: 10 },
    ]);
    expect(extractRows({ byQualification: [{ name: "Q", revenue: 5 }] })).toEqual([
      { name: "Q", revenue: 5 },
    ]);
    expect(extractRows({})).toEqual([]);
  });
});

describe("Phase 5 — currency-aware formatting", () => {
  it("uses each amount's own currency instead of a hardcoded AUD prefix", () => {
    expect(normalizeCurrency("bdt")).toBe("BDT");
    expect(normalizeCurrency("")).toBe("AUD");
    expect(normalizeCurrency(undefined)).toBe("AUD");
    expect(formatMoney(null, "AUD")).toBe("Unavailable");
    expect(formatMoney(1234.5, "AUD")).toContain("1,234.5");
    expect(formatMoney(1234.5, "BDT")).not.toBe(formatMoney(1234.5, "AUD"));
    expect(formatMoney(1234.5, "BDT")).not.toContain("AUD");
    expect(formatMoney(1234.5, "USD")).not.toContain("AUD");
  });
});
