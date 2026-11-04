/**
 * PATCH /api/masters/commission-rules/[id] — update a commission rule
 * DELETE /api/masters/commission-rules/[id] — delete a commission rule
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import {
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

export const PATCH = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) return invalidId();

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const coll = await collection("agent_commission_rules");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Commission rule not found." } },
        { status: 404 },
      );
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const actor = (req as AuthedRequest).auth!;

    if (body.agentId !== undefined) {
      const aid =
        body.agentId === null || body.agentId === ""
          ? null
          : safeObjectId(String(body.agentId));
      if (body.agentId !== null && body.agentId !== "" && !aid) {
        return invalidId();
      }
      update.agentId = aid;
    }
    if (body.responsibility !== undefined) {
      const resp = body.responsibility ? String(body.responsibility) : null;
      if (resp && !VALID_AGENT_TYPES.has(resp)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid responsibility." } },
          { status: 400 },
        );
      }
      update.responsibility = resp;
    }
    // Either agentId or responsibility must be set after update.
    const nextAgentId = update.agentId ?? existing.agentId;
    const nextResp = update.responsibility ?? existing.responsibility;
    if ((nextAgentId === null) === (nextResp === null)) {
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
    if (body.tiers !== undefined) {
      if (!validateTiers(body.tiers)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid tiers." } },
          { status: 400 },
        );
      }
      update.tiers = body.tiers;
    }
    if (body.commissionCurrency !== undefined) {
      if (!isValidCurrency(body.commissionCurrency)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid commission currency." } },
          { status: 400 },
        );
      }
      update.commissionCurrency = body.commissionCurrency;
    }
    if (body.additionalIncentiveAmount !== undefined) {
      const amt =
        body.additionalIncentiveAmount === null ||
        body.additionalIncentiveAmount === undefined
          ? null
          : Number(body.additionalIncentiveAmount);
      if (amt !== null && (!Number.isFinite(amt) || amt < 0)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid additional incentive amount." } },
          { status: 400 },
        );
      }
      update.additionalIncentiveAmount = amt;
    }
    if (body.additionalIncentiveCurrency !== undefined) {
      const cur =
        body.additionalIncentiveCurrency === null ||
        body.additionalIncentiveCurrency === undefined
          ? null
          : String(body.additionalIncentiveCurrency);
      if (cur && !isValidCurrency(cur)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid additional incentive currency." } },
          { status: 400 },
        );
      }
      update.additionalIncentiveCurrency = cur;
    }
    if (body.effectiveFrom !== undefined) {
      if (!isValidDate(body.effectiveFrom)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Effective from date is invalid." } },
          { status: 400 },
        );
      }
      update.effectiveFrom = new Date(String(body.effectiveFrom)).toISOString();
    }
    if (body.effectiveTo !== undefined) {
      update.effectiveTo = body.effectiveTo
        ? new Date(String(body.effectiveTo)).toISOString()
        : null;
      if (update.effectiveTo && !isValidDate(update.effectiveTo as string)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Effective to date is invalid." } },
          { status: 400 },
        );
      }
    }
    if (body.status !== undefined) {
      if (!["active", "inactive"].includes(String(body.status))) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid status." } },
          { status: 400 },
        );
      }
      update.status = String(body.status);
    }
    if (body.approvalStatus !== undefined) {
      const nextApproval = String(body.approvalStatus);
      if (!["draft", "approved", "rejected"].includes(nextApproval)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid approval status." } },
          { status: 400 },
        );
      }
      update.approvalStatus = nextApproval;
      if (nextApproval === "approved" && existing.approvalStatus !== "approved") {
        update.approvedBy = actor.userId;
        update.approvedAt = new Date().toISOString();
      }
    }

    await coll.updateOne({ _id: oid }, { $set: update });
    const updated = await coll.findOne({ _id: oid });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "agent_commission_rule",
      entityId: String(id),
      action: "update",
      before: {
        status: existing.status,
        approvalStatus: existing.approvalStatus,
        tiers: existing.tiers,
      },
      after: {
        status: updated?.status,
        approvalStatus: updated?.approvalStatus,
        tiers: updated?.tiers,
      },
    });

    return NextResponse.json({ commissionRule: mapDoc(updated) });
  },
);

export const DELETE = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) return invalidId();

    const coll = await collection("agent_commission_rules");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Commission rule not found." } },
        { status: 404 },
      );
    }

    await coll.deleteOne({ _id: oid });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "agent_commission_rule",
      entityId: String(id),
      action: "delete",
      before: {
        responsibility: existing.responsibility,
        status: existing.status,
        approvalStatus: existing.approvalStatus,
      },
      after: null,
    });

    return NextResponse.json({ ok: true, id: String(oid) });
  },
);
