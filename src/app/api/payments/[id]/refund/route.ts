/**
 * POST /api/payments/[id]/refund — refund a payment (requires finance.manage)
 * 7-Day Return Policy: full payment refunds are allowed only if requested
 * within 7 days of the payment date. Historical payments older than 7 days
 * cannot be refunded through this endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const RETURN_WINDOW_DAYS = 7;

function isWithinReturnWindow(paymentDate: Date | string): boolean {
  const paidAt = new Date(paymentDate);
  if (Number.isNaN(paidAt.getTime())) return false;
  const now = new Date();
  const diffMs = now.getTime() - paidAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= RETURN_WINDOW_DAYS;
}

export const POST = withAuth("finance.manage",
  async (req: NextRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const paymentOid = safeObjectId(id);
    if (!paymentOid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid payment id." } },
        { status: 400 },
      );
    }

    const actor = (req as AuthedRequest).auth!;

    let body: { reason?: string } | null = null;
    try {
      body = (await req.json()) as { reason?: string } | null;
    } catch {
      // Body is optional; default to no reason.
    }

    const payments = await collection("payments");
    const payment = await payments.findOne({ _id: paymentOid });
    if (!payment) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Payment not found." } },
        { status: 404 },
      );
    }

    if (payment.status === "Refunded" || payment.status === "Void") {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: `Payment is already ${payment.status.toLowerCase()}.` } },
        { status: 400 },
      );
    }

    // 7-Day Return Policy: only allow refund within 7 days of payment date.
    if (!isWithinReturnWindow(payment.date)) {
      return NextResponse.json(
        {
          error: {
            code: "OUTSIDE_RETURN_WINDOW",
            message: `Refunds are only allowed within ${RETURN_WINDOW_DAYS} days of payment. This payment was made on ${new Date(payment.date).toISOString().slice(0, 10)}.`,
          },
        },
        { status: 403 },
      );
    }

    const before = payment.status;

    await payments.updateOne(
      { _id: paymentOid },
      { $set: { status: "Refunded", updatedAt: new Date() } },
    );

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "payment",
      entityId: String(id),
      action: "refund",
      before: { status: before },
      after: { status: "Refunded", refundReason: body?.reason ?? null, refundedAt: new Date() },
    });

    return NextResponse.json({ payment: { id: String(paymentOid), status: "Refunded" } });
  },
);
