/**
 * POST /api/payments/[id]/refund — refund a payment (requires finance.manage)
 * Mirrors Express `POST /payments/:id/refund`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const POST = withAuth("finance.manage",
  async (req: NextRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    let paymentId;
    try {
      paymentId = toObjectId(id);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid payment id." } },
        { status: 400 },
      );
    }

    const payments = await collection("payments");
    const payment = await payments.findOne({ _id: paymentId });
    if (!payment) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Payment not found." } },
        { status: 404 },
      );
    }

    await payments.updateOne(
      { _id: paymentId },
      { $set: { status: "Refunded", updatedAt: new Date() } },
    );

    return NextResponse.json({ payment: { id: String(paymentId), status: "Refunded" } });
  },
);
