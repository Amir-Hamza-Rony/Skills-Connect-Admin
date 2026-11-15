/**
 * GET /api/commission-payouts — list commission payouts
 * POST /api/commission-payouts — record a payout for an approved commission record
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId, getClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "commissions.manage";

function mapDoc(d: any) {
  return {
    id: String(d._id),
    commissionRecordId: String(d.commissionRecordId),
    amount: d.amount,
    currency: d.currency,
    paymentDate: d.paymentDate,
    paymentReference: d.paymentReference,
    status: d.status,
    paidBy: d.paidBy ? String(d.paidBy) : null,
    paidAt: d.paidAt,
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
    const commissionRecordId = searchParams.get("commissionRecordId");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (commissionRecordId) {
      const oid = safeObjectId(commissionRecordId);
      if (!oid) {
        return NextResponse.json(
          { error: { code: "INVALID_ID", message: "Invalid commission record id." } },
          { status: 400 },
        );
      }
      filter.commissionRecordId = oid;
    }
    if (status) filter.status = status;

    const coll = await collection("commission_payouts");
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

    const commissionRecordId = safeObjectId(String(body.commissionRecordId));
    const amount = Number(body.amount);
    const currency = String(body.currency ?? "");
    const paymentDate = body.paymentDate ? new Date(String(body.paymentDate)) : null;
    const paymentReference = String(body.paymentReference ?? "").trim() || null;

    if (!commissionRecordId) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "commissionRecordId is required." } },
        { status: 400 },
      );
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Amount must be a positive number." } },
        { status: 400 },
      );
    }
    if (!["AUD", "BDT", "USD", "GBP", "EUR", "INR"].includes(currency)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid currency." } },
        { status: 400 },
      );
    }

    const client = await getClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        // Duplicate payout prevention: one payout per commission record.
        const payoutsColl = await collection("commission_payouts");
        const existing = await payoutsColl.findOne({ commissionRecordId }, { session });
        if (existing) {
          const err: any = new Error("A payout already exists for this commission record.");
          err.code = "CONFLICT";
          err.status = 409;
          throw err;
        }

        const recordsColl = await collection("commission_records");
        const record = await recordsColl.findOne({ _id: commissionRecordId }, { session });
        if (!record) {
          const err: any = new Error("Commission record not found.");
          err.code = "NOT_FOUND";
          err.status = 404;
          throw err;
        }
        if (record.status !== "approved") {
          const err: any = new Error("Only approved commission records can be paid out.");
          err.code = "BAD_REQUEST";
          err.status = 400;
          throw err;
        }

        const now = new Date();
        await payoutsColl.insertOne(
          {
            commissionRecordId,
            amount,
            currency,
            paymentDate: paymentDate ? paymentDate.toISOString() : null,
            paymentReference,
            status: "paid",
            paidBy: (req as AuthedRequest).auth!.userId,
            paidAt: now.toISOString(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
          { session },
        );

        await recordsColl.updateOne(
          { _id: commissionRecordId },
          { $set: { status: "paid", updatedAt: now.toISOString() } },
          { session },
        );
      });
    } catch (err: any) {
      await session.endSession().catch(() => {});
      return NextResponse.json(
        { error: { code: err.code ?? "SERVER_ERROR", message: err.message ?? "Payout failed." } },
        { status: err.status ?? 500 },
      );
    } finally {
      await session.endSession().catch(() => {});
    }

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "commission_payout",
      entityId: String(commissionRecordId),
      action: "payout",
      before: null,
      after: { amount, currency, status: "paid" },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  },
);
