/**
 * POST /api/commission-records/[id]/reject — reject a commission record
 * Requires a rejection reason.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "commissions.manage";

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

function mapDoc(d: any) {
  return {
    id: String(d._id),
    agentId: String(d.agentId),
    periodMonth: d.periodMonth,
    periodYear: d.periodYear,
    eligibleDealCount: d.eligibleDealCount,
    eligibleDealIds: d.eligibleDealIds.map((x: any) => String(x)),
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

export const POST = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid id." } },
        { status: 400 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const rejectionReason = String(body.rejectionReason ?? "").trim();
    if (!rejectionReason) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Rejection reason is required." } },
        { status: 400 },
      );
    }

    const actor = (req as AuthedRequest).auth!;
    const coll = await collection("commission_records");
    const record = await coll.findOne({ _id: oid });
    if (!record) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Commission record not found." } },
        { status: 404 },
      );
    }

    if (record.status !== "calculated") {
      return NextResponse.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: `Cannot reject a record in ${record.status} status.`,
          },
        },
        { status: 400 },
      );
    }

    const now = new Date();
    await coll.updateOne(
      { _id: oid },
      {
        $set: {
          status: "rejected",
          rejectionReason,
          updatedAt: now.toISOString(),
        },
      },
    );

    const updated = await coll.findOne({ _id: oid });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "commission_record",
      entityId: String(id),
      action: "reject",
      before: { status: record.status },
      after: { status: updated?.status, rejectionReason },
    });

    return NextResponse.json({ commissionRecord: mapDoc(updated) });
  },
);
