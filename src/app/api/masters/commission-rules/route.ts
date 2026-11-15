/**
 * GET /api/masters/commission-rules — list agent commission rules
 * POST /api/masters/commission-rules — create a commission rule
 *
 * Rules are stored as draft/unapproved by default. Management must approve
 * them before they are used for payable commission calculation.
 */

import { NextResponse } from "next/server";
import type { ObjectId as MongoObjectId } from "mongodb";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import {
  requireFields,
  isValidCurrency,
  isValidDate,
  invalidId,
} from "@/lib/pricing-validation";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "commissions.manage";

const VALID_AGENT_TYPES = new Set([
  "sales_closing",
  "certificate_source",
  "rto_contact",
]);

function mapDoc(d: any) {
  return {
    id: String(d._id),
    agentId: d.agentId ? String(d.agentId) : null,
    responsibility: d.responsibility,
    effectiveFrom: d.effectiveFrom,
    effectiveTo: d.effectiveTo,
    tiers: d.tiers,
    commissionCurrency: d.commissionCurrency,
    additionalIncentiveAmount: d.additionalIncentiveAmount,
    additionalIncentiveCurrency: d.additionalIncentiveCurrency,
    status: d.status,
    approvalStatus: d.approvalStatus,
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

function validateTiers(tiers: unknown): boolean {
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  for (const t of tiers) {
    if (
      typeof t.minDeals !== "number" ||
      !Number.isFinite(t.minDeals) ||
      t.minDeals < 0
    ) {
      return false;
    }
    if (
      t.maxDeals !== null &&
      t.maxDeals !== undefined &&
      (typeof t.maxDeals !== "number" || !Number.isFinite(t.maxDeals))
    ) {
      return false;
    }
    if (
      typeof t.commissionPerDeal !== "number" ||
      !Number.isFinite(t.commissionPerDeal) ||
      t.commissionPerDeal < 0
    ) {
      return false;
    }
  }
  return true;
}

export const GET = withAuth(
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const { searchParams } = req.nextUrl;
    const agentId = searchParams.get("agentId");
    const responsibility = searchParams.get("responsibility");
    const status = searchParams.get("status");
    const approvalStatus = searchParams.get("approvalStatus");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (agentId) {
      const oid = safeObjectId(agentId);
      if (!oid) return invalidId();
      filter.agentId = oid;
    }
    if (responsibility) filter.responsibility = responsibility;
    if (status) filter.status = status;
    if (approvalStatus) filter.approvalStatus = approvalStatus;

    const coll = await collection("agent_commission_rules");
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

    const missing = requireFields(body, [
      "effectiveFrom",
      "tiers",
      "commissionCurrency",
      "status",
      "approvalStatus",
    ]);
    if (missing) {
      return NextResponse.json(
        { error: { code: missing.code, message: missing.message } },
        { status: 400 },
      );
    }

    let agentId: MongoObjectId | null = null;
    if (body.agentId !== undefined && body.agentId !== null && body.agentId !== "") {
      agentId = safeObjectId(String(body.agentId));
      if (!agentId) return invalidId();
    }

    const responsibility = body.responsibility
      ? String(body.responsibility)
      : null;
    if (responsibility && !VALID_AGENT_TYPES.has(responsibility)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid responsibility." } },
        { status: 400 },
      );
    }

    // Either agentId OR responsibility must be provided, not both/neither.
    if ((agentId === null) === (responsibility === null)) {
      return NextResponse.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Provide either agentId or responsibility, not both.",
          },
        },
        { status: 400 },
      );
    }

    if (agentId) {
      const agent = await (await collection("agents")).findOne({ _id: agentId });
      if (!agent) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Agent not found." } },
          { status: 404 },
        );
      }
    }

    if (!validateTiers(body.tiers)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Tiers must be a non-empty array of {minDeals, maxDeals?, commissionPerDeal}." } },
        { status: 400 },
      );
    }

    if (!isValidCurrency(body.commissionCurrency)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid commission currency." } },
        { status: 400 },
      );
    }

    const effectiveFrom = new Date(String(body.effectiveFrom));
    if (!isValidDate(body.effectiveFrom)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Effective from date is invalid." } },
        { status: 400 },
      );
    }
    const effectiveTo = body.effectiveTo
      ? new Date(String(body.effectiveTo))
      : null;
    if (effectiveTo && !isValidDate(body.effectiveTo)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Effective to date is invalid." } },
        { status: 400 },
      );
    }

    const status = String(body.status);
    if (!["active", "inactive"].includes(status)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid status." } },
        { status: 400 },
      );
    }

    const approvalStatus = String(body.approvalStatus);
    if (!["draft", "approved", "rejected"].includes(approvalStatus)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid approval status." } },
        { status: 400 },
      );
    }

    const additionalIncentiveAmount =
      body.additionalIncentiveAmount !== undefined && body.additionalIncentiveAmount !== null
        ? Number(body.additionalIncentiveAmount)
        : null;
    if (
      additionalIncentiveAmount !== null &&
      (!Number.isFinite(additionalIncentiveAmount) || additionalIncentiveAmount < 0)
    ) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid additional incentive amount." } },
        { status: 400 },
      );
    }
    let additionalIncentiveCurrency: string | null = null;
    if (body.additionalIncentiveCurrency !== undefined) {
      if (!isValidCurrency(body.additionalIncentiveCurrency)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid additional incentive currency." } },
          { status: 400 },
        );
      }
      additionalIncentiveCurrency = String(body.additionalIncentiveCurrency);
    }

    let approvedBy: string | null = null;
    let approvedAt: string | null = null;
    if (approvalStatus === "approved") {
      const actor = (req as AuthedRequest).auth!;
      approvedBy = actor.userId;
      approvedAt = new Date().toISOString();
    }

    const now = new Date();
    const coll = await collection("agent_commission_rules");
    const result = await coll.insertOne({
      agentId,
      responsibility,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo ? effectiveTo.toISOString() : null,
      tiers: body.tiers,
      commissionCurrency: body.commissionCurrency,
      additionalIncentiveAmount,
      additionalIncentiveCurrency,
      status,
      approvalStatus,
      approvedBy,
      approvedAt,
      createdAt: now,
      updatedAt: now,
    });

    const created = await coll.findOne({ _id: result.insertedId });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "agent_commission_rule",
      entityId: String(created?._id),
      action: "create",
      before: null,
      after: {
        responsibility: created?.responsibility,
        tiers: created?.tiers,
        commissionCurrency: created?.commissionCurrency,
        status: created?.status,
        approvalStatus: created?.approvalStatus,
      },
    });

    return NextResponse.json({ commissionRule: mapDoc(created) }, { status: 201 });
  },
);
