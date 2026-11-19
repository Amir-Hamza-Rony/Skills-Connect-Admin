import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { GET as dashboard } from "@/app/api/reports/dashboard/route";
import { getDb } from "@/lib/db";
import {
  authedRequest,
  clearDb,
  makeSuperAdminToken,
  makeAdminToken,
  makeBDCToken,
  makeB2BAgentToken,
  makeToken,
  seedClient,
  seedQualification,
  seedRto,
  seedOrder,
} from "./helpers";

function json(res: Response): Promise<any> {
  return res.json() as Promise<any>;
}

async function insertRaw(collectionName: string, doc: Record<string, unknown>) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection(collectionName).insertOne({ _id, ...doc });
  return _id;
}

async function insertInvoice(orderId: ObjectId, overrides: Record<string, unknown> = {}) {
  return insertRaw("invoices", {
    orderId,
    invoiceNumber: "INV-TEST",
    total: 1000,
    currency: "AUD",
    dueDate: new Date("2020-01-01"),
    status: "Sent",
    createdAt: new Date(),
    ...overrides,
  });
}

async function insertPayment(
  orderId: ObjectId,
  invoiceId: ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return insertRaw("payments", {
    orderId,
    invoiceId,
    amount: 400,
    allocatedAmount: 400,
    currency: "AUD",
    date: new Date(),
    status: "Allocated",
    method: "Bank Transfer",
    reference: "TEST-PAYMENT",
    createdAt: new Date(),
    ...overrides,
  });
}

async function insertCommission(overrides: Record<string, unknown> = {}) {
  return insertRaw("commission_records", {
    agentId: new ObjectId(),
    periodMonth: 1,
    periodYear: 2027,
    eligibleDealCount: 1,
    eligibleDealIds: [],
    tierApplied: null,
    commissionAmount: 1000,
    commissionCurrency: "AUD",
    exchangeRate: null,
    convertedAmount: null,
    additionalIncentiveAmount: 0,
    status: "approved",
    calculatedBy: null,
    calculatedAt: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

/**
 * Three orders with distinct ownership so role scoping is observable:
 *  - bdcOrder  -> owned by BDC user "test-bdc-1"
 *  - b2bOrder  -> owned by B2B user "test-b2b-1"
 *  - adminOrder -> ownerless (admin-only, fails closed for agents)
 */
async function seedScopedFixture() {
  const qId = await seedQualification();
  const rId = await seedRto();

  const bdcClient = await seedClient(new ObjectId(), "BDC Client", "bdc-client@test.com");
  const b2bClient = await seedClient(new ObjectId(), "B2B Client", "b2b-client@test.com");
  const adminClient = await seedClient(new ObjectId(), "Admin Client", "admin-client@test.com");

  const bdcOrder = await seedOrder(new ObjectId(), bdcClient, qId, new ObjectId(), new ObjectId(), rId, {
    status: "Completed",
    bdc_id: "test-bdc-1",
    sellingPrice: 5000,
    currency: "AUD",
  });
  const b2bOrder = await seedOrder(new ObjectId(), b2bClient, qId, new ObjectId(), new ObjectId(), rId, {
    status: "New",
    b2b_agent_id: "test-b2b-1",
    sellingPrice: 7000,
    currency: "AUD",
  });
  const adminOrder = await seedOrder(new ObjectId(), adminClient, qId, new ObjectId(), new ObjectId(), rId, {
    status: "Awaiting Payment",
    sellingPrice: 9000,
    currency: "AUD",
  });

  return { bdcClient, b2bClient, adminClient, bdcOrder, b2bOrder, adminOrder };
}

describe("Phase 4 — dashboard analytics API: role scoping", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("SUPER_ADMIN receives all scopes, KPI groups and finance availability", async () => {
    await seedScopedFixture();
    const res = await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeSuperAdminToken()));
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body.role).toBe("SUPER_ADMIN");
    expect(body.scope.scoped).toBe(false);
    expect(body.scope.orders).toBe(3);
    expect(body.scope.clients).toBe(3);
    expect(body.availability.finance.available).toBe(true);
    expect(body.kpis.overview.length).toBeGreaterThan(0);
    expect(body.kpis.pipeline.length).toBeGreaterThan(0);
    expect(body.availability.charts.available).toBe(true);
    expect(body.charts.ordersOverTime.length).toBeGreaterThan(0);
  });

  it("ADMIN receives all orders and finance data but no commission management action in the payload", async () => {
    await seedScopedFixture();
    const res = await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeAdminToken()));
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body.role).toBe("ADMIN");
    expect(body.scope.orders).toBe(3);
    expect(body.availability.finance.available).toBe(true);
    expect(body.tables.invoices).toEqual([]);
    expect(body.tables.orders[0].amount).toBe(5000);
  });

  it("BDC sees only bdc_id-owned orders and clients, with cost/margin fields absent", async () => {
    const f = await seedScopedFixture();
    const res = await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeBDCToken()));
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body.role).toBe("BDC");
    expect(body.scope.scoped).toBe(true);
    expect(body.scope.orders).toBe(1);
    expect(body.scope.clients).toBe(1);
    expect(body.tables.orders.map((o: any) => o.id)).toEqual([String(f.bdcOrder)]);
    expect(body.tables.clients.map((c: any) => c.id)).toEqual([String(f.bdcClient)]);

    expect(body.availability.finance.available).toBe(false);
    expect(body.kpis.finance).toEqual([]);
    expect(body.currencyTotals).toEqual([]);
    expect(body.tables.invoices).toEqual([]);
    expect(body.charts.revenueOverTime).toEqual([]);

    // BDC is allowed to see selling price via the `amount` field.
    expect(body.tables.orders[0].amount).toBe(5000);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("supplierCostSnapshot");
    expect(serialized).not.toContain("grossMargin");
    expect(serialized).not.toContain("marginPercent");
  });

  it("B2B_AGENT sees only b2b_agent_id-owned orders with all price/revenue fields absent", async () => {
    const f = await seedScopedFixture();
    const res = await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeB2BAgentToken()));
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body.role).toBe("B2B_AGENT");
    expect(body.scope.scoped).toBe(true);
    expect(body.scope.orders).toBe(1);
    expect(body.scope.clients).toBe(1);
    expect(body.tables.orders.map((o: any) => o.id)).toEqual([String(f.b2bOrder)]);
    expect(body.tables.clients.map((c: any) => c.id)).toEqual([String(f.b2bClient)]);

    expect(body.availability.finance.available).toBe(false);
    expect(body.availability.commission.available).toBe(false);
    expect(body.kpis.finance).toEqual([]);
    expect(body.kpis.commission).toEqual([]);
    expect(body.currencyTotals).toEqual([]);
    expect(body.tables.invoices).toEqual([]);
    expect(body.charts.revenueOverTime).toEqual([]);
    expect(body.tables.orders[0].amount).toBeUndefined();
    expect(body.tables.orders[0].currency).toBeUndefined();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("supplierCostSnapshot");
    expect(serialized).not.toContain("invoiced\"");
    expect(serialized).not.toContain("collected\"");
    expect(serialized).not.toContain("outstanding\"");
  });

  it("rejects unauthenticated requests (401) and callers without reports.view (403)", async () => {
    const noAuth = await dashboard(new NextRequest("http://localhost/api/reports/dashboard"));
    expect(noAuth.status).toBe(401);

    const noPermission = makeToken(["BDC"], ["clients.view", "orders.view"]);
    const res = await dashboard(
      authedRequest("GET", "/api/reports/dashboard", undefined, noPermission),
    );
    expect(res.status).toBe(403);
  });
});

describe("Phase 4 — dashboard analytics API: accuracy and availability", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("computes overdue from due date minus allocations, not total outstanding", async () => {
    const qId = await seedQualification();
    const rId = await seedRto();
    const client = await seedClient();
    const order = await seedOrder(new ObjectId(), client, qId, new ObjectId(), new ObjectId(), rId);

    const overdueInvoice = await insertInvoice(order, {
      total: 1000,
      dueDate: new Date("2020-01-01"),
      status: "Sent",
    });
    await insertPayment(order, overdueInvoice, { allocatedAmount: 400 });
    // A second, not-yet-due invoice must NOT be counted as overdue.
    await insertInvoice(order, { total: 2000, dueDate: new Date("2099-01-01"), status: "Sent" });

    const res = await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeSuperAdminToken()));
    const body = await json(res);

    const aud = body.currencyTotals.find((c: any) => c.currency === "AUD");
    expect(aud.invoiced).toBe(3000);
    expect(aud.collected).toBe(400);
    expect(aud.outstanding).toBe(2600);
    expect(aud.overdue).toBe(600);

    const overdueKpi = body.kpis.finance.find((k: any) => k.id === "overdue-AUD");
    expect(overdueKpi.value).toBe(600);
    expect(overdueKpi.value).not.toBe(aud.outstanding);
  });

  it("keeps mixed currencies separate and never presents a summed total", async () => {
    const qId = await seedQualification();
    const rId = await seedRto();
    const client = await seedClient();
    const order = await seedOrder(new ObjectId(), client, qId, new ObjectId(), new ObjectId(), rId);

    await insertInvoice(order, { total: 5000, currency: "AUD" });
    await insertInvoice(order, { total: 6000, currency: "BDT" });

    const res = await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeSuperAdminToken()));
    const body = await json(res);

    expect(body.currencyTotals).toHaveLength(2);
    const aud = body.currencyTotals.find((c: any) => c.currency === "AUD");
    const bdt = body.currencyTotals.find((c: any) => c.currency === "BDT");
    expect(aud.invoiced).toBe(5000);
    expect(bdt.invoiced).toBe(6000);
    // There is no top-level cross-currency total anywhere in the payload.
    expect(body).not.toHaveProperty("totalOutstanding");
    expect(body).not.toHaveProperty("totalInvoiced");
  });

  it("includes only approved or paid commission records", async () => {
    await seedScopedFixture();
    await insertCommission({ status: "calculated", commissionAmount: 999, commissionCurrency: "AUD" });
    await insertCommission({ status: "approved", commissionAmount: 1000, commissionCurrency: "AUD" });
    await insertCommission({ status: "paid", commissionAmount: 2000, commissionCurrency: "AUD" });

    const res = await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeSuperAdminToken()));
    const body = await json(res);

    expect(body.availability.commission.available).toBe(true);
    const kpi = body.kpis.commission.find((k: any) => k.id === "commission-AUD");
    expect(kpi.value).toBe(3000);
    expect(JSON.stringify(body)).not.toContain("999");
  });

  it("narrows results with status/date/agent filters without widening scope", async () => {
    await seedScopedFixture();
    const base = await json(
      await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeSuperAdminToken())),
    );
    expect(base.scope.orders).toBe(3);

    const statusFiltered = await json(
      await dashboard(authedRequest("GET", "/api/reports/dashboard?status=Completed", undefined, makeSuperAdminToken())),
    );
    expect(statusFiltered.scope.orders).toBe(1);

    const dateFiltered = await json(
      await dashboard(authedRequest("GET", "/api/reports/dashboard?from=2099-01-01T00:00:00.000Z", undefined, makeSuperAdminToken())),
    );
    expect(dateFiltered.scope.orders).toBe(0);
    expect(dateFiltered.availability.charts.available).toBe(false);

    // Agent filter is admins-only; an agent cannot widen its own scope via it.
    const b2bWithAgentFilter = await json(
      await dashboard(authedRequest("GET", "/api/reports/dashboard?agentId=someone-else", undefined, makeB2BAgentToken())),
    );
    expect(b2bWithAgentFilter.scope.orders).toBe(1);
    expect(b2bWithAgentFilter.filters.agentId).toBeNull();
  });

  it("returns explicit empty/unavailable states with no NaN on an empty database", async () => {
    const res = await dashboard(authedRequest("GET", "/api/reports/dashboard", undefined, makeSuperAdminToken()));
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body.scope.orders).toBe(0);
    expect(body.scope.clients).toBe(0);
    expect(body.currencyTotals).toEqual([]);
    expect(body.tables.orders).toEqual([]);
    expect(body.tables.clients).toEqual([]);
    expect(body.availability.charts.available).toBe(false);
    expect(body.availability.commission.available).toBe(false);
    expect(JSON.stringify(body)).not.toContain("NaN");

    const allKpis = Object.values(body.kpis).flat() as any[];
    for (const kpi of allKpis) {
      if (kpi.value !== null && (kpi.unit === "count" || kpi.unit === "money")) {
        expect(Number.isFinite(kpi.value)).toBe(true);
      }
    }
  });
});
