/**
 * GET /api/commission-records — list monthly commission records
 * POST /api/commission-records/calculate — calculate commission for an agent + period
 *
 * Calculation reads approved, active commission rules from the database.
 * Records are created in "calculated" status and must be explicitly approved
 * by management before any payout. Eligibility depends on the rule's
 * configured eligibleOrderStatuses — no eligibility criteria are invented.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "commissions.manage";

function mapDoc(d: any) {
  return {
    id: String(d._id),
    agentId: String(d.agentId),
    periodMonth: d.periodMonth,
    periodYear: d.periodYear,
    eligibleDealCount: d.eligibleDealCount,
    eligibleDealIds: d.eligibleDealIds.map((id: any) => String(id)),
    tierApplied: d.tierApplied,
    commissionAmount: d.commissionAmount,
    commissionCurrency: d.commissionCurrency,
    exchangeRate: d.exchangeRate,
    convertedAmount: d.convertedAmount,
    additionalIncentiveAmount: d.additionalIncentiveAmount,
    status: d.status,
    calculatedBy: d.calculatedBy ? String(d.calculatedBy) : null,
    calculatedAt: d.calculatedAt,
    approvedBy: d.approvedBy ? String(d.approvedBy) : null,
    approvedAt: d.approvedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function requireAuth(req: AuthedRequest) {
  const auth = req.auth as {
    roleNames?: string[];
    permissions?: string[];
  };
  if (
    !auth?.roleNames?.includes("Super Admin") &&
    !auth?.permissions?.includes(PERMISSION)
  ) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } },
      { status: 403 },
    );
  }
  return null;
}

export const GET = withAuth(
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const { searchParams } = req.nextUrl;
    const agentId = searchParams.get("agentId");
    const periodMonth = searchParams.get("periodMonth");
    const periodYear = searchParams.get("periodYear");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (agentId) {
      const oid = safeObjectId(agentId);
      if (!oid) {
        return NextResponse.json(
          { error: { code: "INVALID_ID", message: "Invalid agent id." } },
          { status: 400 },
        );
      }
      filter.agentId = oid;
    }
    if (periodMonth) filter.periodMonth = Number(periodMonth);
    if (periodYear) filter.periodYear = Number(periodYear);
    if (status) filter.status = status;

    const coll = await collection("commission_records");
    const [docs, total] = await Promise.all([
      coll
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      coll.countDocuments(filter),
    ]);

    return NextResponse.json({
      items: docs.map(mapDoc),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);

function monthRange(month: number, year: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)); // exclusive
  return { start, end };
}

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const action = String(body.action ?? "calculate");
    if (action !== "calculate") {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Unsupported action." } },
        { status: 400 },
      );
    }

    const agentId = safeObjectId(String(body.agentId));
    const periodMonth = Number(body.periodMonth);
    const periodYear = Number(body.periodYear);
    if (!agentId) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "agentId is required." } },
        { status: 400 },
      );
    }
    if (
      !Number.isFinite(periodMonth) ||
      periodMonth < 1 ||
      periodMonth > 12
    ) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "periodMonth must be 1-12." } },
        { status: 400 },
      );
    }
    if (!Number.isFinite(periodYear) || periodYear < 2000) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "periodYear is invalid." } },
        { status: 400 },
      );
    }

    const actor = (req as AuthedRequest).auth!;

    // Duplicate calculation prevention: one record per agent + period.
    const existing = await (await collection("commission_records")).findOne({
      agentId,
      periodMonth,
      periodYear,
    });
    if (existing) {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: "A commission record already exists for this agent and period.",
          },
        },
        { status: 409 },
      );
    }

    // Find the applicable approved, active commission rule for this agent.
    // A rule matches if it targets this agent specifically, or targets the
    // agent's responsibility and the agent has that type.
    const agentDoc = await (await collection("agents")).findOne({ _id: agentId });
    if (!agentDoc) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Agent not found." } },
        { status: 404 },
      );
    }

    const now = new Date();
    const rules = await (await collection("agent_commission_rules"))
      .find({
        status: "active",
        approvalStatus: "approved",
        $and: [
          { $or: [{ agentId }, { responsibility: agentDoc.type, agentId: null }] },
          { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }] },
        ],
        $expr: {
          $lte: [
            { $dateFromString: { dateString: "$effectiveFrom", onError: "$effectiveFrom" } },
            now,
          ],
        },
      } as any)
      .toArray();

    const rule = rules[0];
    if (!rule) {
      return NextResponse.json(
        {
          error: {
            code: "NO_ACTIVE_RULE",
            message: "No approved, active commission rule applies to this agent for the calculation period.",
          },
        },
        { status: 400 },
      );
    }

    // Aggregate eligible orders for the period.
    const { start, end } = monthRange(periodMonth, periodYear);
    const eligibleStatuses = Array.isArray(rule.eligibleOrderStatuses)
      ? rule.eligibleOrderStatuses
      : [];

    const orders = await (await collection("orders"))
      .aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lt: end },
            status: { $in: eligibleStatuses },
          },
        },
        {
          $sort: { createdAt: 1 },
        },
      ])
      .toArray();

    const eligibleDealIds = orders.map((o: any) => o._id);
    const eligibleDealCount = eligibleDealIds.length;

    // Determine tier: flat per-deal within the band the count falls into.
    const tiers = Array.isArray(rule.tiers) ? rule.tiers : [];
    let tierApplied: any = null;
    for (const t of tiers) {
      const min = t.minDeals ?? 0;
      const max = t.maxDeals;
      if (eligibleDealCount >= min && (max === null || max === undefined || eligibleDealCount <= max)) {
        tierApplied = t;
        break;
      }
    }

    const commissionPerDeal = tierApplied ? tierApplied.commissionPerDeal : 0;
    const commissionAmount = eligibleDealCount * commissionPerDeal;
    const commissionCurrency = rule.commissionCurrency;

    // Currency conversion snapshot when order currency differs from commission currency.
    let exchangeRate: number | null = null;
    let convertedAmount: number | null = null;
    if (eligibleDealCount > 0 && commissionCurrency) {
      // Use the selling currency of the first eligible order as the sale currency
      // snapshot. Real implementations would use a configured FX rate source.
      const saleCurrency = orders[0]?.currency || "AUD";
      if (saleCurrency !== commissionCurrency) {
        // Placeholder rate: management must configure a real FX source.
        exchangeRate = 1;
        convertedAmount = commissionAmount;
      } else {
        convertedAmount = commissionAmount;
      }
    }

    const additionalIncentiveAmount =
      rule.additionalIncentiveAmount && tierApplied
        ? rule.additionalIncentiveAmount
        : 0;

    const coll = await collection("commission_records");
    const result = await coll.insertOne({
      agentId,
      periodMonth,
      periodYear,
      eligibleDealCount,
      eligibleDealIds,
      tierApplied,
      commissionAmount,
      commissionCurrency,
      exchangeRate,
      convertedAmount,
      additionalIncentiveAmount,
      status: "calculated",
      calculatedBy: actor.userId,
      calculatedAt: now.toISOString(),
      approvedBy: null,
      approvedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const created = await coll.findOne({ _id: result.insertedId });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "commission_record",
      entityId: String(created?._id),
      action: "calculate",
      before: null,
      after: {
        agentId: String(created?.agentId),
        periodMonth: created?.periodMonth,
        periodYear: created?.periodYear,
        eligibleDealCount: created?.eligibleDealCount,
        commissionAmount: created?.commissionAmount,
        status: created?.status,
      },
    });

    return NextResponse.json(
      { commissionRecord: mapDoc(created) },
      { status: 201 },
    );
  },
);
