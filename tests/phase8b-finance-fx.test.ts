import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { POST as createInvoice } from "@/app/api/invoices/route";
import { GET as listInvoices } from "@/app/api/invoices/route";
import { POST as recordPayment } from "@/app/api/payments/route";
import { GET as listPayments } from "@/app/api/payments/route";
import { POST as calculateCommission } from "@/app/api/commission-records/route";
import { POST as createPayout } from "@/app/api/commission-payouts/route";
import { GET as financeSummary } from "@/app/api/finance/summary/route";
import { getDb } from "@/lib/db";

import {
  authedRequest,
  clearDb,
  makeSuperAdminToken,
  seedAgent,
  seedCommissionRule,
  seedOrder,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

async function seedAudOrder(overrides: Record<string, unknown> = {}) {
  return seedOrder(
    new ObjectId(),
    new ObjectId(),
    undefined,
    undefined,
    undefined,
    undefined,
    { currency: "AUD", ...overrides },
  );
}

describe("Phase 8B — AUD-only new financial transactions", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates a new invoice in AUD", async () => {
    const orderId = await seedAudOrder();
    const res = await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: String(orderId),
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        lineItems: [{ id: "line-1", description: "Tuition", amount: 1000, currency: "AUD", quantity: 1, taxAmount: 0, taxRate: 0 }],
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.invoice.currency).toBe("AUD");
    expect(body.invoice.total).toBe(1000);
  });

  it("rejects a new invoice with a non-AUD currency", async () => {
    const orderId = await seedAudOrder();
    const res = await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: String(orderId),
        currency: "BDT",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        lineItems: [{ id: "line-1", description: "Tuition", amount: 1000, currency: "BDT", quantity: 1, taxAmount: 0, taxRate: 0 }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("AUD");

    // The invoice must not have been created.
    const db = await getDb();
    const count = await db.collection("invoices").countDocuments({ orderId });
    expect(count).toBe(0);
  });

  it("records a new payment in AUD by default", async () => {
    const orderId = await seedAudOrder();
    const invoiceRes = await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: String(orderId),
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        lineItems: [{ id: "line-1", description: "Tuition", amount: 1000, currency: "AUD", quantity: 1, taxAmount: 0, taxRate: 0 }],
      }),
    );
    const invoiceId = (await json(invoiceRes)).invoice.id;

    const res = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId,
        amount: 1000,
        date: "2027-02-15",
        method: "Bank Transfer",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.payment.currency).toBe("AUD");
  });

  it("rejects a new payment with a non-AUD currency", async () => {
    const orderId = await seedAudOrder();
    const invoiceRes = await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: String(orderId),
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        lineItems: [{ id: "line-1", description: "Tuition", amount: 1000, currency: "AUD", quantity: 1, taxAmount: 0, taxRate: 0 }],
      }),
    );
    const invoiceId = (await json(invoiceRes)).invoice.id;

    const res = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId,
        amount: 1000,
        date: "2027-02-15",
        method: "Bank Transfer",
        currency: "USD",
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("AUD");
  });

  it("creates a new commission record in AUD", async () => {
    const agentId = await seedAgent("sales_closing");
    await seedCommissionRule(new ObjectId(), agentId, "AUD");

    const db = await getDb();
    const now = new Date(Date.UTC(2027, 0, 15));
    await db.collection("orders").insertOne({
      clientId: new ObjectId(),
      qualificationId: new ObjectId(),
      salesAgentId: agentId,
      sourceAgentId: new ObjectId(),
      rtoId: new ObjectId(),
      status: "Completed",
      sellingPrice: 5000,
      supplierCostSnapshot: 1000,
      currency: "AUD",
      createdAt: now,
      updatedAt: now,
      history: [],
    });

    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.commissionRecord.commissionCurrency).toBe("AUD");
    expect(body.commissionRecord.exchangeRate).toBeNull();
    expect(body.commissionRecord.convertedAmount).toBe(4000);
  });

  it("rejects a new commission rule with a non-AUD currency", async () => {
    const agentId = await seedAgent("sales_closing");
    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    // No AUD rule exists: calculation must fail closed rather than create a
    // non-AUD commission record.
    expect(res.status).toBe(400);
  });

  it("records a new commission payout in AUD", async () => {
    const db = await getDb();
    const now = new Date();
    const recordId = new ObjectId();
    await db.collection("commission_records").insertOne({
      _id: recordId,
      agentId: new ObjectId(),
      periodMonth: 1,
      periodYear: 2027,
      eligibleDealCount: 1,
      eligibleDealIds: [],
      tierApplied: null,
      commissionAmount: 1000,
      commissionCurrency: "AUD",
      exchangeRate: null,
      convertedAmount: 1000,
      additionalIncentiveAmount: 0,
      status: "approved",
      calculatedBy: null,
      calculatedAt: now.toISOString(),
      approvedBy: "test-user-1",
      approvedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const res = await createPayout(
      authedRequest("POST", "/api/commission-payouts", {
        commissionRecordId: String(recordId),
        amount: 1000,
        currency: "AUD",
        paymentDate: "2027-02-01",
        paymentReference: "PAY-001",
      }),
    );
    expect(res.status).toBe(201);

    const db2 = await getDb();
    const payout = await db2.collection("commission_payouts").findOne({ commissionRecordId: recordId });
    expect(payout.currency).toBe("AUD");
  });

  it("rejects a new commission payout with a non-AUD currency", async () => {
    const db = await getDb();
    const now = new Date();
    const recordId = new ObjectId();
    await db.collection("commission_records").insertOne({
      _id: recordId,
      agentId: new ObjectId(),
      periodMonth: 1,
      periodYear: 2027,
      eligibleDealCount: 1,
      eligibleDealIds: [],
      tierApplied: null,
      commissionAmount: 1000,
      commissionCurrency: "AUD",
      exchangeRate: null,
      convertedAmount: 1000,
      additionalIncentiveAmount: 0,
      status: "approved",
      calculatedBy: null,
      calculatedAt: now.toISOString(),
      approvedBy: "test-user-1",
      approvedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const res = await createPayout(
      authedRequest("POST", "/api/commission-payouts", {
        commissionRecordId: String(recordId),
        amount: 1000,
        currency: "GBP",
        paymentDate: "2027-02-01",
        paymentReference: "PAY-002",
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("AUD");
  });

  it("keeps historical BDT invoices readable and unchanged", async () => {
    const orderId = new ObjectId();
    const db = await getDb();
    await db.collection("orders").insertOne({
      _id: orderId,
      clientId: new ObjectId(),
      qualificationId: new ObjectId(),
      salesAgentId: new ObjectId(),
      sourceAgentId: new ObjectId(),
      rtoId: new ObjectId(),
      status: "Completed",
      sellingPrice: 5000,
      supplierCostSnapshot: 1000,
      currency: "BDT",
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [],
    });
    await db.collection("invoices").insertOne({
      orderId,
      invoiceNumber: "INV-HIST-BDT-1",
      total: 7500,
      currency: "BDT",
      issueDate: "2026-01-01",
      dueDate: "2026-02-01",
      status: "Sent",
      lineItems: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await listInvoices(authedRequest("GET", "/api/invoices?currency=BDT"));
    const body = await json(res);
    expect(body.invoices.length).toBeGreaterThanOrEqual(1);
    const inv = body.invoices.find((i: any) => i.invoiceNumber === "INV-HIST-BDT-1");
    expect(inv).toBeTruthy();
    expect(inv.currency).toBe("BDT");
    expect(inv.total).toBe(7500);
  });

  it("keeps historical USD records readable and unchanged", async () => {
    const orderId = new ObjectId();
    const db = await getDb();
    await db.collection("orders").insertOne({
      _id: orderId,
      clientId: new ObjectId(),
      qualificationId: new ObjectId(),
      salesAgentId: new ObjectId(),
      sourceAgentId: new ObjectId(),
      rtoId: new ObjectId(),
      status: "Completed",
      sellingPrice: 3000,
      supplierCostSnapshot: 1000,
      currency: "USD",
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [],
    });
    await db.collection("payments").insertOne({
      orderId,
      invoiceId: null,
      amount: 2000,
      allocatedAmount: 2000,
      currency: "USD",
      status: "Allocated",
      date: new Date(),
      method: "Bank Transfer",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await listPayments(authedRequest("GET", "/api/payments"));
    const body = await json(res);
    const pay = body.payments.find((p: any) => p.currency === "USD");
    expect(pay).toBeTruthy();
    expect(pay.currency).toBe("USD");
    expect(pay.amount).toBe(2000);
  });

  it("keeps historical GBP records readable and unchanged", async () => {
    const db = await getDb();
    await db.collection("invoices").insertOne({
      orderId: new ObjectId(),
      invoiceNumber: "INV-HIST-GBP",
      total: 4000,
      currency: "GBP",
      status: "Draft",
      lineItems: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await listInvoices(authedRequest("GET", "/api/invoices?currency=GBP"));
    const body = await json(res);
    const inv = body.invoices.find((i: any) => i.invoiceNumber === "INV-HIST-GBP");
    expect(inv).toBeTruthy();
    expect(inv.currency).toBe("GBP");
    expect(inv.total).toBe(4000);
  });

  it("does not modify historical amounts or currencies", async () => {
    const orderId = new ObjectId();
    const db = await getDb();
    await db.collection("invoices").insertOne({
      orderId,
      invoiceNumber: "INV-IMMUTABLE",
      total: 5000,
      currency: "EUR",
      status: "Sent",
      lineItems: [],
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });

    // Reading must not alter the stored record.
    const res = await listInvoices(authedRequest("GET", "/api/invoices?currency=EUR"));
    const body = await json(res);
    const inv = body.invoices.find((i: any) => i.invoiceNumber === "INV-IMMUTABLE");
    expect(inv.total).toBe(5000);
    expect(inv.currency).toBe("EUR");

    const stored = await db.collection("invoices").findOne({ invoiceNumber: "INV-IMMUTABLE" });
    expect(stored.total).toBe(5000);
    expect(stored.currency).toBe("EUR");
  });

  it("keeps mixed-currency financial summaries safe (no cross-currency sum)", async () => {
    const clientId = new ObjectId();
    const db = await getDb();
    for (const currency of ["AUD", "USD"]) {
      const orderId = new ObjectId();
      await db.collection("orders").insertOne({
        _id: orderId,
        clientId,
        qualificationId: new ObjectId(),
        salesAgentId: new ObjectId(),
        sourceAgentId: new ObjectId(),
        rtoId: new ObjectId(),
        status: "Completed",
        sellingPrice: 1000,
        supplierCostSnapshot: 0,
        currency,
        createdAt: new Date(),
        updatedAt: new Date(),
        history: [],
      });
      await db.collection("invoices").insertOne({
        orderId,
        invoiceNumber: `INV-MIX-${currency}`,
        total: 1000,
        currency,
        status: "Draft",
        lineItems: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const res = await financeSummary(
      authedRequest("GET", "/api/finance/summary"),
    );
    const body = await json(res);
    expect(body.mixedCurrency).toBe(true);
    expect(body.invoiced).toBeNull();
    expect(body.collected).toBeNull();
    expect(body.converted).toBe(false);
    const currencies = body.currencyBreakdown.map((c: any) => c.currency).sort();
    expect(currencies).toEqual(["AUD", "USD"]);
    const aud = body.currencyBreakdown.find((c: any) => c.currency === "AUD");
    const usd = body.currencyBreakdown.find((c: any) => c.currency === "USD");
    expect(aud.invoiced).toBe(1000);
    expect(usd.invoiced).toBe(1000);
  });
});
