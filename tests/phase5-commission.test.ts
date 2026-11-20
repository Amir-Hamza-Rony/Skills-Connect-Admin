import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { POST as createCommissionRule } from "@/app/api/masters/commission-rules/route";
import { POST as calculateCommission } from "@/app/api/commission-records/route";
import { POST as approveCommission } from "@/app/api/commission-records/[id]/approve/route";
import { POST as createPayout } from "@/app/api/commission-payouts/route";
import { GET as agentCommissionReport } from "@/app/api/reports/agent-commission/route";
import { GET as monthlySummaryReport } from "@/app/api/reports/monthly-summary/route";
import { getDb } from "@/lib/db";

import {
  authedRequest,
  clearDb,
  makeAdminToken,
  makeBDCToken,
  makeSuperAdminToken,
  seedAgent,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

async function insertCompletedOrder(
  agentField: "salesAgentId" | "sourceAgentId" | "rtoContactId",
  agentId: ObjectId,
  status = "Completed",
) {
  const db = await getDb();
  const now = new Date(Date.UTC(2027, 0, 15));
  const id = new ObjectId();
  await db.collection("orders").insertOne({
    _id: id,
    clientId: new ObjectId(),
    qualificationId: new ObjectId(),
    salesAgentId: agentField === "salesAgentId" ? agentId : new ObjectId(),
    sourceAgentId: agentField === "sourceAgentId" ? agentId : new ObjectId(),
    rtoId: new ObjectId(),
    [agentField]: agentId,
    status,
    sellingPrice: 5000,
    supplierCostSnapshot: 1000,
    currency: "BDT",
    createdAt: now,
    updatedAt: now,
    history: [],
  });
  return id;
}

async function insertRule(overrides: Record<string, unknown> = {}) {
  const db = await getDb();
  const now = new Date();
  const id = new ObjectId();
  await db.collection("agent_commission_rules").insertOne({
    _id: id,
    agentId: new ObjectId(),
    responsibility: null,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    tiers: [{ minDeals: 1, maxDeals: null, commissionPerDeal: 4000 }],
    eligibleOrderStatuses: ["Completed"],
    commissionCurrency: "BDT",
    additionalIncentiveAmount: null,
    additionalIncentiveCurrency: null,
    status: "active",
    approvalStatus: "approved",
    approvedBy: "test-user-1",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  return id;
}

async function insertCommissionRecord(overrides: Record<string, unknown> = {}) {
  const db = await getDb();
  const now = new Date();
  const id = new ObjectId();
  await db.collection("commission_records").insertOne({
    _id: id,
    agentId: new ObjectId(),
    periodMonth: 1,
    periodYear: 2027,
    eligibleDealCount: 2,
    eligibleDealIds: [],
    tierApplied: null,
    commissionAmount: 8000,
    commissionCurrency: "BDT",
    exchangeRate: null,
    convertedAmount: 8000,
    additionalIncentiveAmount: 0,
    status: "approved",
    calculatedBy: "test-user-1",
    calculatedAt: now.toISOString(),
    approvedBy: "test-user-1",
    approvedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  });
  return id;
}

describe("Phase 5 — commission corrections", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("persists API-created eligibility and end-date snapshots", async () => {
    const agentId = await seedAgent("sales_closing");
    const res = await createCommissionRule(
      authedRequest("POST", "/api/masters/commission-rules", {
        agentId: String(agentId),
        effectiveFrom: "2026-01-01",
        effectiveTo: "2027-12-31",
        eligibleOrderStatuses: ["Completed"],
        tiers: [{ minDeals: 1, maxDeals: null, commissionPerDeal: 4000 }],
        commissionCurrency: "BDT",
        status: "active",
        approvalStatus: "approved",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.commissionRule.eligibleOrderStatuses).toEqual(["Completed"]);

    const db = await getDb();
    const stored = await db
      .collection("agent_commission_rules")
      .findOne({ _id: new ObjectId(body.commissionRule.id) });
    expect(stored?.eligibleOrderStatuses).toEqual(["Completed"]);
    expect(stored?.effectiveFrom).toBeInstanceOf(Date);
    expect(stored?.effectiveTo).toBeInstanceOf(Date);

    await insertCompletedOrder("salesAgentId", agentId);
    await insertCompletedOrder("salesAgentId", agentId, "New");

    const calc = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    expect(calc.status).toBe(201);
    const calcBody = await json(calc);
    expect(calcBody.commissionRecord.eligibleDealCount).toBe(1);
    expect(calcBody.commissionRecord.commissionAmount).toBe(4000);
  });

  it("fails closed when more than one rule applies", async () => {
    const agentId = await seedAgent("sales_closing");
    await insertRule({ agentId });
    await insertRule({ agentId });
    await insertCompletedOrder("salesAgentId", agentId);

    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("AMBIGUOUS_RULE");
  });

  it("attributes orders using the rule responsibility only", async () => {
    const agentId = await seedAgent("certificate_source");
    await insertRule({
      agentId: null,
      responsibility: "certificate_source",
    });
    await insertCompletedOrder("sourceAgentId", agentId);
    await insertCompletedOrder("salesAgentId", agentId);

    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    expect(res.status).toBe(201);
    expect((await json(res)).commissionRecord.eligibleDealCount).toBe(1);
  });

  it("prevents concurrent-style double approval", async () => {
    const recordId = await insertCommissionRecord({ status: "calculated" });
    const first = await approveCommission(
      authedRequest("POST", `/api/commission-records/${recordId}/approve`),
      { params: { id: String(recordId) } },
    );
    expect(first.status).toBe(200);

    const second = await approveCommission(
      authedRequest("POST", `/api/commission-records/${recordId}/approve`),
      { params: { id: String(recordId) } },
    );
    expect(second.status).toBe(409);
    expect((await json(second)).error.code).toBe("CONFLICT");
  });

  it("requires payout amount and currency to match the approved record", async () => {
    const recordId = await insertCommissionRecord();

    const wrongCurrency = await createPayout(
      authedRequest("POST", "/api/commission-payouts", {
        commissionRecordId: String(recordId),
        amount: 8000,
        currency: "AUD",
      }),
    );
    expect(wrongCurrency.status).toBe(400);

    const payout = await createPayout(
      authedRequest("POST", "/api/commission-payouts", {
        commissionRecordId: String(recordId),
        amount: 8000,
        currency: "BDT",
      }),
    );
    expect(payout.status).toBe(201);

    const duplicate = await createPayout(
      authedRequest("POST", "/api/commission-payouts", {
        commissionRecordId: String(recordId),
        amount: 8000,
        currency: "BDT",
      }),
    );
    expect(duplicate.status).toBe(409);
  });

  it("reports one agent row per commission currency", async () => {
    const agentId = await seedAgent("sales_closing");
    await insertCommissionRecord({
      agentId,
      commissionAmount: 100,
      commissionCurrency: "AUD",
      convertedAmount: 100,
    });
    await insertCommissionRecord({
      agentId,
      commissionAmount: 200,
      commissionCurrency: "BDT",
      convertedAmount: 200,
    });

    const res = await agentCommissionReport(
      authedRequest("GET", "/api/reports/agent-commission"),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.mixedCurrency).toBe(true);
    expect(body.totals).toBeNull();
    expect(body.agentCommission).toHaveLength(2);
    expect(body.agentCommission.map((row: any) => row.commissionCurrency).sort()).toEqual([
      "AUD",
      "BDT",
    ]);
  });

  it("excludes calculated commission from monthly summary", async () => {
    const agentId = await seedAgent("sales_closing");
    await insertCommissionRecord({
      agentId,
      status: "approved",
      commissionAmount: 100,
      commissionCurrency: "AUD",
    });
    await insertCommissionRecord({
      agentId,
      status: "calculated",
      commissionAmount: 999,
      commissionCurrency: "AUD",
    });

    const res = await monthlySummaryReport(
      authedRequest("GET", "/api/reports/monthly-summary"),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    const row = body.monthlySummary.find((item: any) => item.month === "2027-01");
    expect(row.byCurrency.AUD.commissionEarned).toBe(100);
  });

  it("excludes orders assigned to a different agent under sales_closing responsibility", async () => {
    const agentId = await seedAgent("sales_closing");
    const otherAgentId = new ObjectId();

    await insertRule({
      agentId: null,
      responsibility: "sales_closing",
    });

    // Order owned by this agent — should be counted.
    await insertCompletedOrder("salesAgentId", agentId);
    // Order owned by a different agent — should NOT be counted.
    await insertCompletedOrder("salesAgentId", otherAgentId);

    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    expect(res.status).toBe(201);
    expect((await json(res)).commissionRecord.eligibleDealCount).toBe(1);
  });

  it("rejects BDC access to commission calculation", async () => {
    const agentId = await seedAgent("sales_closing");
    await insertRule({ agentId, responsibility: "sales_closing" });
    await insertCompletedOrder("salesAgentId", agentId);

    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }, makeBDCToken()),
    );
    expect(res.status).toBe(403);
  });

  it("rejects ADMIN access to commission calculation (lacks commissions.manage)", async () => {
    const agentId = await seedAgent("sales_closing");
    await insertRule({ agentId, responsibility: "sales_closing" });
    await insertCompletedOrder("salesAgentId", agentId);

    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }, makeAdminToken()),
    );
    expect(res.status).toBe(403);
  });

  it("allows SUPER_ADMIN commission calculation", async () => {
    const agentId = await seedAgent("sales_closing");
    await insertRule({ agentId, responsibility: "sales_closing" });
    await insertCompletedOrder("salesAgentId", agentId);

    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }, makeSuperAdminToken()),
    );
    expect(res.status).toBe(201);
  });
});
