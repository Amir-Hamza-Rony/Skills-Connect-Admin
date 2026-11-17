/**
 * Security Hotfix — regression coverage for F8, F9, F10a, F10b and F10c.
 *
 * Verifies role-based financial field visibility (BDC / B2B_AGENT / ADMIN /
 * SUPER_ADMIN), timeline ownership scoping, and payment-plan authorization
 * ordering. All fixtures live in the in-memory replica set (tests/setup.ts);
 * no production database is used.
 */

import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signAccessToken } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import {
  authedRequest,
  clearDb,
  makeAdminToken,
  makeB2BAgentToken,
  makeBDCToken,
  makeSuperAdminToken,
  seedClient,
  seedInvoice,
  seedOrder,
  seedPlan,
} from "./helpers";
import { GET as getOrderDetail } from "@/app/api/orders/[id]/route";
import { GET as listOrders } from "@/app/api/orders/route";
import { GET as getTimeline } from "@/app/api/orders/[id]/timeline/route";
import { GET as getPaymentPlan } from "@/app/api/orders/[id]/payment-plan/route";
import { GET as ordersReport } from "@/app/api/reports/orders/route";
import { GET as marginReport } from "@/app/api/reports/margin/route";
import { GET as supplierCostReport } from "@/app/api/reports/supplier-costs/route";
import { GET as monthlySummaryReport } from "@/app/api/reports/monthly-summary/route";
import { GET as revenueReport } from "@/app/api/reports/revenue/route";
import { GET as revenueBySupplierReport } from "@/app/api/reports/revenue-by-supplier/route";
import { GET as financeReport } from "@/app/api/reports/finance/route";
import { GET as exportReport } from "@/app/api/reports/[type]/export/route";

const BDC_1 = "hotfix-bdc-1";
const BDC_2 = "hotfix-bdc-2";
const B2B_1 = "hotfix-b2b-1";
const B2B_2 = "hotfix-b2b-2";

/** Non-admin token that also carries finance.view, to exercise F10c. */
function financeToken(role: "BDC" | "B2B_AGENT", userId: string) {
  return signAccessToken({
    userId,
    name: "Finance Viewer",
    email: `${role.toLowerCase()}@finance.test`,
    full_name: "Finance Viewer",
    role,
    roleNames: [role],
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
    permissions: ["orders.view", "finance.view", "reports.view"],
  });
}

const ALL_ROLES = [
  { label: "BDC", token: makeBDCToken(BDC_1), price: true },
  { label: "B2B_AGENT", token: makeB2BAgentToken(B2B_1), price: false },
  { label: "ADMIN", token: makeAdminToken(), price: true },
  { label: "SUPER_ADMIN", token: makeSuperAdminToken(), price: true },
] as const;

type Scenario = {
  bdcOrder: ObjectId;
  b2bOrder: ObjectId;
  bdcOrderNoPlan: ObjectId;
  qualId: ObjectId;
  rtoId: ObjectId;
};

async function seedScenario(): Promise<Scenario> {
  const clientA = await seedClient(undefined, "Hotfix A", "hotfix-a@example.com");
  const clientB = await seedClient(undefined, "Hotfix B", "hotfix-b@example.com");
  const clientC = await seedClient(undefined, "Hotfix C", "hotfix-c@example.com");
  const qualId = new ObjectId();
  const rtoId = new ObjectId();
  const financials = {
    sellingPrice: 5000,
    supplierCostSnapshot: 1500,
    otherCost: 500,
    currency: "AUD",
    feeTotal: 0,
  };

  const bdcOrder = await seedOrder(new ObjectId(), clientA, qualId, new ObjectId(), new ObjectId(), rtoId, {
    ...financials,
    bdc_id: BDC_1,
    channel_type: "B2C_BDC",
  });
  const b2bOrder = await seedOrder(new ObjectId(), clientB, qualId, new ObjectId(), new ObjectId(), rtoId, {
    ...financials,
    b2b_agent_id: B2B_1,
    channel_type: "B2B_AGENT",
  });
  const bdcOrderNoPlan = await seedOrder(new ObjectId(), clientC, qualId, new ObjectId(), new ObjectId(), rtoId, {
    ...financials,
    bdc_id: BDC_1,
    channel_type: "B2C_BDC",
  });

  await seedInvoice(new ObjectId(), bdcOrder, 5000);
  const db = await getDb();
  await db.collection("payments").insertOne({
    orderId: bdcOrder,
    invoiceId: new ObjectId(),
    allocatedAmount: 1000,
    status: "Paid",
    method: "Card",
    currency: "AUD",
    createdAt: new Date(),
  });
  await seedPlan(new ObjectId(), bdcOrder, 5000);
  await seedPlan(new ObjectId(), b2bOrder, 5000);

  return { bdcOrder, b2bOrder, bdcOrderNoPlan, qualId, rtoId };
}

beforeEach(async () => {
  await clearDb();
});

describe("Security hotfix — F9/F8 order detail field visibility", () => {
  it("grossMargin is admin-only and sellingPrice is hidden from B2B_AGENT", async () => {
    const { bdcOrder, b2bOrder } = await seedScenario();
    for (const { label, token, price } of ALL_ROLES) {
      const order = label === "B2B_AGENT" ? b2bOrder : bdcOrder;
      const res = await getOrderDetail(
        authedRequest("GET", `/api/orders/${order}`, undefined, token),
        { params: { id: String(order) } },
      );
      expect(res.status, `${label} detail status`).toBe(200);
      const body = await res.json();
      const admin = label === "ADMIN" || label === "SUPER_ADMIN";

      expect(keyIn(body, "supplierCostSnapshot")).toBe(admin);
      expect(keyIn(body, "grossMargin")).toBe(admin);
      expect(keyIn(body, "sellingPrice")).toBe(price);
      if (admin) expect(body.grossMargin).toBe(3000); // 5000 - 1500 - 500
    }
  });
});

function keyIn(record: Record<string, unknown>, key: string): boolean {
  return key in record;
}

describe("Security hotfix — F8 order list field visibility", () => {
  it("sellingPrice is visible to BDC and admins but never to B2B_AGENT", async () => {
    await seedScenario();
    for (const { label, token, price } of ALL_ROLES) {
      const res = await listOrders(authedRequest("GET", "/api/orders", undefined, token));
      expect(res.status, `${label} list status`).toBe(200);
      const { orders } = await res.json();
      expect(orders.length).toBeGreaterThan(0);
      for (const row of orders) {
        expect(keyIn(row, "sellingPrice"), `${label} sellingPrice`).toBe(price);
        expect(keyIn(row, "supplierCostSnapshot"), `${label} supplierCostSnapshot`).toBe(
          label === "ADMIN" || label === "SUPER_ADMIN",
        );
      }
    }
  });
});

describe("Security hotfix — F10a report field visibility (all four roles)", () => {
  it("order report hides supplierCost/margin from non-admins and all price data from B2B_AGENT", async () => {
    await seedScenario();
    for (const { label, token, price } of ALL_ROLES) {
      const res = await ordersReport(authedRequest("GET", "/api/reports/orders", undefined, token));
      expect(res.status, `${label} order report status`).toBe(200);
      const { orders } = await res.json();
      expect(orders.length).toBeGreaterThan(0);
      const admin = label === "ADMIN" || label === "SUPER_ADMIN";
      for (const row of orders) {
        expect(keyIn(row, "supplierCost"), `${label} supplierCost`).toBe(admin);
        expect(keyIn(row, "margin"), `${label} margin`).toBe(admin);
        expect(keyIn(row, "sellingPrice"), `${label} sellingPrice`).toBe(price);
        expect(keyIn(row, "invoiced"), `${label} invoiced`).toBe(price);
        expect(keyIn(row, "paid"), `${label} paid`).toBe(price);
        expect(keyIn(row, "outstanding"), `${label} outstanding`).toBe(price);
      }
    }
  });

  it("margin report hides cost/margin/percent from non-admins and revenue from B2B_AGENT", async () => {
    await seedScenario();
    for (const { label, token, price } of ALL_ROLES) {
      const res = await marginReport(authedRequest("GET", "/api/reports/margin", undefined, token));
      const body = await res.json();
      expect(body.byQualification.length).toBeGreaterThan(0);
      const admin = label === "ADMIN" || label === "SUPER_ADMIN";
      for (const row of body.byQualification) {
        expect(keyIn(row, "cost"), `${label} cost`).toBe(admin);
        expect(keyIn(row, "margin"), `${label} margin`).toBe(admin);
        expect(keyIn(row, "percent"), `${label} percent`).toBe(admin);
        expect(keyIn(row, "revenue"), `${label} revenue`).toBe(price);
      }
    }
  });

  it("supplier-costs report masks nested rows and totals; clientInvoiced is B2B-hidden", async () => {
    await seedScenario();
    for (const { label, token, price } of ALL_ROLES) {
      const res = await supplierCostReport(authedRequest("GET", "/api/reports/supplier-costs", undefined, token));
      const body = await res.json();
      expect(body.supplierCosts.length).toBeGreaterThan(0);
      const admin = label === "ADMIN" || label === "SUPER_ADMIN";
      for (const row of body.supplierCosts) {
        expect(keyIn(row, "supplierCost"), `${label} row supplierCost`).toBe(admin);
        expect(keyIn(row, "margin"), `${label} row margin`).toBe(admin);
        expect(keyIn(row, "clientInvoiced"), `${label} row clientInvoiced`).toBe(price);
      }
      expect(keyIn(body.totals, "supplierCost"), `${label} totals supplierCost`).toBe(admin);
      expect(keyIn(body.totals, "margin"), `${label} totals margin`).toBe(admin);
      expect(keyIn(body.totals, "clientInvoiced"), `${label} totals clientInvoiced`).toBe(price);
    }
  });

  it("monthly-summary report masks nested byCurrency and totals at every level", async () => {
    await seedScenario();
    for (const { label, token, price } of ALL_ROLES) {
      const res = await monthlySummaryReport(authedRequest("GET", "/api/reports/monthly-summary", undefined, token));
      const body = await res.json();
      expect(body.monthlySummary.length).toBeGreaterThan(0);
      const admin = label === "ADMIN" || label === "SUPER_ADMIN";
      for (const row of body.monthlySummary) {
        for (const cur of Object.values(row.byCurrency) as Record<string, unknown>[]) {
          expect(keyIn(cur, "supplierCost"), `${label} byCurrency supplierCost`).toBe(admin);
          expect(keyIn(cur, "invoiced"), `${label} byCurrency invoiced`).toBe(price);
          expect(keyIn(cur, "collected"), `${label} byCurrency collected`).toBe(price);
          expect(keyIn(cur, "outstanding"), `${label} byCurrency outstanding`).toBe(price);
          expect(keyIn(cur, "commissionEarned"), `${label} byCurrency commissionEarned`).toBe(price);
        }
        expect(keyIn(row.totals, "supplierCost"), `${label} totals supplierCost`).toBe(admin);
        expect(keyIn(row.totals, "commissionEarned"), `${label} totals commissionEarned`).toBe(price);
      }
    }
  });

  it("revenue-derived reports hide revenue from B2B_AGENT only", async () => {
    await seedScenario();
    const reports = [
      { name: "revenue", handler: revenueReport, key: "byQualification" },
      { name: "revenue-by-supplier", handler: revenueBySupplierReport, key: "byRto" },
    ] as const;
    for (const report of reports) {
      for (const { label, token, price } of ALL_ROLES) {
        const res = await report.handler(authedRequest("GET", `/api/reports/${report.name}`, undefined, token));
        const body = await res.json();
        const rows = body[report.key] as Record<string, unknown>[];
        expect(rows.length, `${label} ${report.name} rows`).toBeGreaterThan(0);
        for (const row of rows) {
          expect(keyIn(row, "revenue"), `${label} ${report.name} revenue`).toBe(price);
          expect(keyIn(row, "orders"), `${label} ${report.name} order count`).toBe(true);
        }
      }
    }
  });

  it("finance report hides pipelineValue and revenue aggregates from B2B_AGENT only", async () => {
    await seedScenario();
    for (const { label, token, price } of ALL_ROLES) {
      const res = await financeReport(authedRequest("GET", "/api/reports/finance", undefined, token));
      const body = await res.json();
      for (const field of ["pipelineValue", "invoiced", "collected", "outstanding", "overdueAmount"]) {
        expect(keyIn(body, field), `${label} ${field}`).toBe(price);
      }
      expect(keyIn(body, "orders"), `${label} order count`).toBe(true);
      expect(keyIn(body, "clients"), `${label} client count`).toBe(true);
      expect(keyIn(body, "overdueCount"), `${label} overdue count`).toBe(true);
    }
  });
});

describe("Security hotfix — F10a exports inherit the role policy", () => {
  // The export route re-fetches the report with the caller's token and flattens
  // whatever that report returns. We capture that payload (the exporter's only
  // data source) and assert it is already masked for the caller's role.
  // NOTE: the existing workbook writer emits an empty buffer (pre-existing
  // defect, out of scope for this hotfix), so columns are asserted on the
  // captured source rows rather than on a parsed .xlsx file.
  async function exportedReportRows(token: string): Promise<Record<string, unknown>[]> {
    let captured: Record<string, unknown>[] = [];
    let fetchCount = 0;
    vi.stubGlobal("fetch", async (_input: unknown, init: any) => {
      fetchCount += 1;
      const authHeader = init?.headers?.Authorization ?? "";
      const innerToken = String(authHeader).replace("Bearer ", "");
      const inner = await ordersReport(authedRequest("GET", "/api/reports/orders", undefined, innerToken));
      const body = await inner.json();
      captured = body.orders ?? [];
      return new Response(JSON.stringify(body), {
        status: inner.status,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const res = await exportReport(
        authedRequest("GET", "/api/reports/orders/export?format=xlsx", undefined, token),
        { params: { type: "orders" } },
      );
      expect(res.status).toBe(200);
      expect(fetchCount).toBe(1);
      return captured;
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("exported report payload is masked identically for all four roles", async () => {
    await seedScenario();
    const expectations = [
      { label: "BDC", token: makeBDCToken(BDC_1), price: true, admin: false },
      { label: "B2B_AGENT", token: makeB2BAgentToken(B2B_1), price: false, admin: false },
      { label: "ADMIN", token: makeAdminToken(), price: true, admin: true },
      { label: "SUPER_ADMIN", token: makeSuperAdminToken(), price: true, admin: true },
    ];
    for (const role of expectations) {
      const rows = await exportedReportRows(role.token);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(keyIn(row, "supplierCost"), `${role.label} supplierCost`).toBe(role.admin);
        expect(keyIn(row, "margin"), `${role.label} margin`).toBe(role.admin);
        expect(keyIn(row, "sellingPrice"), `${role.label} sellingPrice`).toBe(role.price);
        expect(keyIn(row, "invoiced"), `${role.label} invoiced`).toBe(role.price);
      }
    }
  });
});

describe("Security hotfix — F10b timeline ownership", () => {
  it("rightful BDC/B2B owners can read their own timeline; other owners get 403", async () => {
    const { bdcOrder, b2bOrder } = await seedScenario();
    const cases = [
      { label: "BDC owner", token: makeBDCToken(BDC_1), order: bdcOrder, status: 200 },
      { label: "BDC non-owner", token: makeBDCToken(BDC_2), order: bdcOrder, status: 403 },
      { label: "B2B owner", token: makeB2BAgentToken(B2B_1), order: b2bOrder, status: 200 },
      { label: "B2B non-owner", token: makeB2BAgentToken(B2B_2), order: b2bOrder, status: 403 },
    ];
    for (const c of cases) {
      const res = await getTimeline(
        authedRequest("GET", `/api/orders/${c.order}/timeline`, undefined, c.token),
        { params: { id: String(c.order) } },
      );
      expect(res.status, `${c.label} timeline status`).toBe(c.status);
      if (c.status === 200) expect((await res.json()).events.length).toBeGreaterThan(0);
    }
  });

  it("admins retain timeline access on any order", async () => {
    const { bdcOrder, b2bOrder } = await seedScenario();
    for (const token of [makeAdminToken(), makeSuperAdminToken()]) {
      for (const order of [bdcOrder, b2bOrder]) {
        const res = await getTimeline(
          authedRequest("GET", `/api/orders/${order}/timeline`, undefined, token),
          { params: { id: String(order) } },
        );
        expect(res.status).toBe(200);
      }
    }
  });
});

describe("Security hotfix — F10c payment-plan authorization ordering", () => {
  it("non-owners get the same 403 whether or not a plan exists", async () => {
    const { bdcOrder, bdcOrderNoPlan, b2bOrder } = await seedScenario();
    const cases = [
      { label: "BDC non-owner", token: financeToken("BDC", BDC_2), order: bdcOrder },
      { label: "BDC non-owner (no plan)", token: financeToken("BDC", BDC_2), order: bdcOrderNoPlan },
      { label: "B2B non-owner", token: financeToken("B2B_AGENT", B2B_2), order: b2bOrder },
    ];
    const responses: string[] = [];
    for (const c of cases) {
      const res = await getPaymentPlan(
        authedRequest("GET", `/api/orders/${c.order}/payment-plan`, undefined, c.token),
        { params: { id: String(c.order) } },
      );
      expect(res.status, `${c.label} status`).toBe(403);
      responses.push(JSON.stringify(await res.json()));
    }
    expect(new Set(responses).size).toBe(1); // no existence oracle
  });

  it("owners and admins get 200 with the plan when present and plan:null otherwise", async () => {
    const { bdcOrder, bdcOrderNoPlan, b2bOrder } = await seedScenario();
    const cases = [
      { label: "BDC owner with plan", token: financeToken("BDC", BDC_1), order: bdcOrder, hasPlan: true },
      { label: "BDC owner without plan", token: financeToken("BDC", BDC_1), order: bdcOrderNoPlan, hasPlan: false },
      { label: "B2B owner with plan", token: financeToken("B2B_AGENT", B2B_1), order: b2bOrder, hasPlan: true },
      { label: "ADMIN", token: makeAdminToken(), order: bdcOrderNoPlan, hasPlan: false },
      { label: "SUPER_ADMIN", token: makeSuperAdminToken(), order: bdcOrderNoPlan, hasPlan: false },
    ];
    for (const c of cases) {
      const res = await getPaymentPlan(
        authedRequest("GET", `/api/orders/${c.order}/payment-plan`, undefined, c.token),
        { params: { id: String(c.order) } },
      );
      expect(res.status, `${c.label} status`).toBe(200);
      const body = await res.json();
      expect(body.plan !== null, `${c.label} plan presence`).toBe(c.hasPlan);
    }
  });

  it("a missing order returns 404 before any plan lookup", async () => {
    const missing = new ObjectId();
    const res = await getPaymentPlan(
      authedRequest("GET", `/api/orders/${missing}/payment-plan`, undefined, financeToken("BDC", BDC_1)),
      { params: { id: String(missing) } },
    );
    expect(res.status).toBe(404);
  });
});
