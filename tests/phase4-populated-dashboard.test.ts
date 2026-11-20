/**
 * Controlled synthetic dataset for Phase 4 dashboard aggregation.
 *
 * Uses the dedicated in-memory MongoDB replica set from tests/setup.ts.
 * No production database, client record or business transaction is touched.
 * The data below is entirely fictional and uses generic synthetic names.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { GET as dashboard } from "@/app/api/reports/dashboard/route";
import { getDb } from "@/lib/db";
import {
  clearDb,
  makeAdminToken,
  makeBDCToken,
  makeB2BAgentToken,
  seedAgent,
  seedClient,
  seedOrder,
  seedQualification,
  seedRto,
} from "./helpers";

const BDC_USER = "qa-bdc-user";
const B2B_USER = "qa-b2b-user";

function request(token: string) {
  return new NextRequest("http://localhost/api/reports/dashboard", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function insertRaw(collectionName: string, doc: Record<string, unknown>) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection(collectionName).insertOne({ _id, ...doc });
  return _id;
}

async function seedPopulatedDataset() {
  const q1 = await seedQualification(new ObjectId(), "SYN-Q1");
  const q2 = await seedQualification(new ObjectId(), "SYN-Q2");
  const rto = await seedRto(new ObjectId(), "SYN-RTO");
  const salesAgent = await seedAgent("sales_closing", new ObjectId());
  const sourceAgent = await seedAgent("certificate_source", new ObjectId());

  const c1 = await seedClient(new ObjectId(), "Synthetic Client One", "synth-one@test.com");
  const c2 = await seedClient(new ObjectId(), "Synthetic Client Two", "synth-two@test.com");
  const c3 = await seedClient(new ObjectId(), "Synthetic Client Three", "synth-three@test.com");

  const common = {
    qualificationId: q1,
    rtoId: rto,
    salesAgentId: salesAgent,
    sourceAgentId: sourceAgent,
    rtoContactId: salesAgent,
  };

  const o1 = await seedOrder(new ObjectId(), c1, q1, salesAgent, sourceAgent, rto, {
    ...common,
    status: "Completed",
    currency: "AUD",
    sellingPrice: 5000,
    bdc_id: BDC_USER,
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    rtoSubmissionStatus: "Issued",
    certificateStatus: "Certificate File Received",
  });
  const o2 = await seedOrder(new ObjectId(), c1, q1, salesAgent, sourceAgent, rto, {
    ...common,
    status: "Awaiting Documents",
    currency: "AUD",
    sellingPrice: 3000,
    bdc_id: BDC_USER,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    rtoSubmissionStatus: "Not Ready",
  });
  const o3 = await seedOrder(new ObjectId(), c2, q2, salesAgent, sourceAgent, rto, {
    ...common,
    qualificationId: q2,
    status: "New",
    currency: "BDT",
    sellingPrice: 7000,
    b2b_agent_id: B2B_USER,
    createdAt: new Date("2026-10-05T00:00:00.000Z"),
    rtoSubmissionStatus: "Not Ready",
  });
  const o4 = await seedOrder(new ObjectId(), c2, q2, salesAgent, sourceAgent, rto, {
    ...common,
    qualificationId: q2,
    status: "Under Assessment",
    currency: "AUD",
    sellingPrice: 4000,
    b2b_agent_id: B2B_USER,
    createdAt: new Date("2026-10-15T00:00:00.000Z"),
    rtoSubmissionStatus: "Under Assessment",
  });
  const o5 = await seedOrder(new ObjectId(), c3, q1, salesAgent, sourceAgent, rto, {
    ...common,
    status: "Submitted to RTO",
    currency: "AUD",
    sellingPrice: 9000,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    rtoSubmissionStatus: "Submitted",
  });
  const o6 = await seedOrder(new ObjectId(), c3, q2, salesAgent, sourceAgent, rto, {
    ...common,
    qualificationId: q2,
    status: "Cancelled",
    currency: "BDT",
    sellingPrice: 2000,
    createdAt: new Date("2026-11-05T00:00:00.000Z"),
    rtoSubmissionStatus: "Not Ready",
  });
  const o7 = await seedOrder(new ObjectId(), c1, q1, salesAgent, sourceAgent, rto, {
    ...common,
    status: "Refunded",
    currency: "AUD",
    sellingPrice: 1000,
    bdc_id: BDC_USER,
    createdAt: new Date("2026-11-10T00:00:00.000Z"),
    rtoSubmissionStatus: "Not Ready",
  });
  const o8 = await seedOrder(new ObjectId(), c2, q2, salesAgent, sourceAgent, rto, {
    ...common,
    qualificationId: q2,
    status: "Completed",
    currency: "BDT",
    sellingPrice: 8000,
    b2b_agent_id: B2B_USER,
    createdAt: new Date("2026-11-15T00:00:00.000Z"),
    rtoSubmissionStatus: "Issued",
    certificateStatus: "Certificate File Received",
  });

  for (const [orderId, status] of [
    [o1, "Approved"],
    [o2, "Requested"],
    [o2, "Not Received"],
    [o3, "Received"],
    [o4, "Rejected"],
    [o5, "Requested"],
  ] as const) {
    await insertRaw("documents", { orderId, status, type: "Synthetic document" });
  }

  for (const [orderId, status] of [
    [o2, "Todo"],
    [o4, "In Progress"],
    [o5, "Done"],
  ] as const) {
    await insertRaw("workflow-tasks", { orderId, status, title: "Synthetic task" });
  }

  await insertRaw("rto-processing", { orderId: o1, submissionStatus: "Submitted to RTO" });
  await insertRaw("rto-processing", { orderId: o5, submissionStatus: "Acknowledged" });

  await insertRaw("certificates", { orderId: o1, status: "Certificate File Received", fileData: "synthetic" });
  await insertRaw("certificates", { orderId: o8, status: "Certificate File Received" });
  // Collection name must match the API routes: certificate_deliveries.
  await insertRaw("certificate_deliveries", { orderId: o1, deliveryStatus: "delivered" });
  await insertRaw("certificate_deliveries", { orderId: o8, deliveryStatus: "pending" });

  const inv1 = await insertRaw("invoices", {
    orderId: o1, invoiceNumber: "SYN-INV-1", total: 5000, currency: "AUD",
    status: "Paid", dueDate: new Date("2020-01-01"),
  });
  const inv2 = await insertRaw("invoices", {
    orderId: o2, invoiceNumber: "SYN-INV-2", total: 3000, currency: "AUD",
    status: "Part Paid", dueDate: new Date("2020-01-01"),
  });
  await insertRaw("invoices", {
    orderId: o3, invoiceNumber: "SYN-INV-3", total: 7000, currency: "BDT",
    status: "Sent", dueDate: new Date("2099-01-01"),
  });
  await insertRaw("invoices", {
    orderId: o4, invoiceNumber: "SYN-INV-4", total: 4000, currency: "AUD",
    status: "Void", dueDate: new Date("2020-01-01"),
  });
  await insertRaw("invoices", {
    orderId: o5, invoiceNumber: "SYN-INV-5", total: 9000, currency: "AUD",
    status: "Overdue", dueDate: new Date("2020-01-01"),
  });
  const inv6 = await insertRaw("invoices", {
    orderId: o8, invoiceNumber: "SYN-INV-6", total: 8000, currency: "BDT",
    status: "Paid", dueDate: new Date("2020-01-01"),
  });

  for (const [orderId, invoiceId, allocatedAmount, currency] of [
    [o1, inv1, 5000, "AUD"],
    [o2, inv2, 1000, "AUD"],
    [o8, inv6, 8000, "BDT"],
  ] as const) {
    await insertRaw("payments", {
      orderId, invoiceId, allocatedAmount, currency,
      status: "Allocated", amount: allocatedAmount,
    });
  }
  // Unallocated receipt: reported separately from invoice collection.
  await insertRaw("payments", {
    orderId: o7, invoiceId: null, allocatedAmount: 500, currency: "AUD",
    status: "Unallocated", amount: 500,
  });

  for (const override of [
    { status: "calculated", commissionAmount: 999, commissionCurrency: "AUD", periodYear: 2026, periodMonth: 10 },
    { status: "approved", commissionAmount: 1000, commissionCurrency: "AUD", periodYear: 2026, periodMonth: 10 },
    { status: "paid", commissionAmount: 500, commissionCurrency: "AUD", periodYear: 2026, periodMonth: 11 },
    { status: "approved", commissionAmount: 2000, commissionCurrency: "BDT", periodYear: 2026, periodMonth: 11 },
  ]) {
    await insertRaw("commission_records", {
      agentId: salesAgent,
      eligibleDealCount: 1,
      eligibleDealIds: [],
      tierApplied: null,
      exchangeRate: null,
      convertedAmount: null,
      additionalIncentiveAmount: 0,
      calculatedBy: null,
      calculatedAt: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date("2026-11-19T00:00:00.000Z"),
      updatedAt: new Date("2026-11-19T00:00:00.000Z"),
      ...override,
    });
  }

  return { q1, q2, rto, salesAgent, sourceAgent, c1, c2, c3, o1, o2, o3, o4, o5, o6, o7, o8 };
}

async function dashboardBody(token: string) {
  const res = await dashboard(request(token));
  expect(res.status).toBe(200);
  return res.json() as Promise<any>;
}

function kpi(body: any, group: string, id: string) {
  return body.kpis[group].find((k: any) => k.id === id)?.value;
}

describe("Phase 4 — populated synthetic dashboard dataset", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("aggregates overview, pipeline and charts from real scoped rows", async () => {
    const f = await seedPopulatedDataset();
    const body = await dashboardBody(makeAdminToken());

    expect(body.role).toBe("ADMIN");
    expect(body.scope).toMatchObject({ scoped: false, clients: 3, orders: 8 });

    expect(kpi(body, "overview", "clients")).toBe(3);
    expect(kpi(body, "overview", "orders")).toBe(8);
    expect(kpi(body, "overview", "completed")).toBe(2);
    expect(kpi(body, "overview", "cancelled")).toBe(2);
    expect(kpi(body, "overview", "pending")).toBe(4);
    expect(kpi(body, "overview", "missingDocuments")).toBe(3);
    expect(kpi(body, "overview", "certProgress")).toBe(2);
    expect(kpi(body, "overview", "followUps")).toBe(2);

    expect(kpi(body, "pipeline", "submittedRto")).toBe(4);
    expect(kpi(body, "pipeline", "underAssessment")).toBe(1);
    expect(kpi(body, "pipeline", "certDelivered")).toBe(1);
    expect(kpi(body, "pipeline", "rtoProcessingRecords")).toBe(2);

    expect(body.charts.ordersOverTime).toEqual([
      { month: "2026-09", count: 2 },
      { month: "2026-10", count: 2 },
      { month: "2026-11", count: 4 },
    ]);
    expect(body.charts.statusDistribution).toEqual([
      { status: "Completed", count: 2 },
      { status: "Awaiting Documents", count: 1 },
      { status: "New", count: 1 },
      { status: "Under Assessment", count: 1 },
      { status: "Submitted to RTO", count: 1 },
      { status: "Cancelled", count: 1 },
      { status: "Refunded", count: 1 },
    ]);
    expect(body.charts.qualificationDistribution.map((q: any) => q.count)).toEqual([4, 4]);
    expect(body.charts.revenueOverTime).toEqual(
      expect.arrayContaining([
        { month: "2026-09", currency: "AUD", amount: 8000 },
        { month: "2026-10", currency: "AUD", amount: 4000 },
        { month: "2026-10", currency: "BDT", amount: 7000 },
        { month: "2026-11", currency: "AUD", amount: 10000 },
        { month: "2026-11", currency: "BDT", amount: 10000 },
      ]),
    );
    expect(body.charts.agentPerformance.length).toBeGreaterThan(0);
    expect(body.tables.orders).toHaveLength(8);
    expect(body.tables.clients).toHaveLength(3);
    expect(body.tables.invoices).toHaveLength(6); // table lists all in-scope invoices; totals exclude void
    expect(body.tables.tasks).toHaveLength(3); // table lists all tasks; openTasks KPI excludes Done
    expect(kpi(body, "overview", "clients")).toBe(3);
    expect(body.scope.clients).toBe(3);
    expect(f.o1).toBeDefined();
  });

  it("keeps finance and commission totals per currency with no simulated conversion", async () => {
    await seedPopulatedDataset();
    const body = await dashboardBody(makeAdminToken());

    const aud = body.currencyTotals.find((c: any) => c.currency === "AUD");
    const bdt = body.currencyTotals.find((c: any) => c.currency === "BDT");
    expect(body.currencyTotals).toHaveLength(2);
    expect(aud).toMatchObject({
      invoiced: 17000,
      collected: 6000,
      unallocated: 500,
      outstanding: 11000,
      overdue: 11000,
    });
    expect(bdt).toMatchObject({
      invoiced: 15000,
      collected: 8000,
      unallocated: 0,
      outstanding: 7000,
      overdue: 0,
    });

    expect(kpi(body, "finance", "invoiced-AUD")).toBe(17000);
    expect(kpi(body, "finance", "collected-BDT")).toBe(8000);
    expect(kpi(body, "finance", "unallocated-AUD")).toBe(500);
    expect(kpi(body, "commission", "commission-AUD")).toBe(1500);
    expect(kpi(body, "commission", "commission-BDT")).toBe(2000);
    expect(body.availability.commission.available).toBe(true);

    expect(body.charts.commissionTrend).toEqual(
      expect.arrayContaining([
        { month: "2026-10", currency: "AUD", amount: 1000 },
        { month: "2026-11", currency: "AUD", amount: 500 },
        { month: "2026-11", currency: "BDT", amount: 2000 },
      ]),
    );
    expect(body).not.toHaveProperty("totalInvoiced");
    expect(body).not.toHaveProperty("totalOutstanding");
    expect(JSON.stringify(body)).not.toContain("999");
  });

  it("scopes BDC and B2B_AGENT to their own synthetic owners and masks finance", async () => {
    const f = await seedPopulatedDataset();

    const bdc = await dashboardBody(makeBDCToken(BDC_USER));
    expect(bdc.role).toBe("BDC");
    expect(bdc.scope).toMatchObject({ scoped: true, clients: 1, orders: 3 });
    expect(bdc.tables.orders.map((o: any) => o.id).sort()).toEqual(
      [String(f.o1), String(f.o2), String(f.o7)].sort(),
    );
    expect(bdc.tables.orders[0].amount).toBeDefined();
    expect(bdc.tables.clients.map((c: any) => c.id)).toEqual([String(f.c1)]);
    expect(bdc.availability.finance.available).toBe(false);
    expect(bdc.currencyTotals).toEqual([]);
    expect(bdc.tables.invoices).toEqual([]);

    const b2b = await dashboardBody(makeB2BAgentToken(B2B_USER));
    expect(b2b.role).toBe("B2B_AGENT");
    expect(b2b.scope).toMatchObject({ scoped: true, clients: 1, orders: 3 });
    expect(b2b.tables.orders.map((o: any) => o.id).sort()).toEqual(
      [String(f.o3), String(f.o4), String(f.o8)].sort(),
    );
    expect(b2b.tables.orders[0].amount).toBeUndefined();
    expect(b2b.tables.clients.map((c: any) => c.id)).toEqual([String(f.c2)]);
    expect(b2b.charts.revenueOverTime).toEqual([]);
    expect(b2b.availability.commission.available).toBe(false);

    for (const body of [bdc, b2b]) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("supplierCostSnapshot");
      expect(serialized).not.toContain("grossMargin");
      expect(serialized).not.toContain("marginPercent");
    }
  });
});
