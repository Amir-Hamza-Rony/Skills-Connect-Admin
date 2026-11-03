/**
 * POST /api/payments/[id]/refund — refund a payment (requires finance.manage)
 * Mirrors Express `POST /payments/:id/refund`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

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

    const payments = await collection("payments");
    const payment = await payments.findOne({ _id: paymentOid });
    if (!payment) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Payment not found." } },
        { status: 404 },
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
      after: { status: "Refunded" },
    });

    return NextResponse.json({ payment: { id: String(paymentOid), status: "Refunded" } });
  },
);
