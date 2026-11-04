/**
 * POST /api/payments/[id]/reverse-allocation — reverse a payment's allocation
 * against its invoice. Requires finance.manage. Transaction-safe.
 *
 * Reversing restores the invoice outstanding balance and marks the payment
 * Unallocated. Historical payment records are preserved.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId, getClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const POST = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const actor = (req as AuthedRequest).auth!;
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const paymentOid = safeObjectId(id);
    if (!paymentOid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid payment id." } },
        { status: 400 },
      );
    }

    const client = await getClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const payments = await collection("payments");
        const payment = await payments.findOne({ _id: paymentOid }, { session });
        if (!payment) {
          const err: any = new Error("Payment not found.");
          err.code = "NOT_FOUND";
          err.status = 404;
          throw err;
        }
        if (payment.status === "Refunded" || payment.status === "Void") {
          const err: any = new Error("Cannot reverse a refunded or voided payment.");
          err.code = "BAD_REQUEST";
          err.status = 400;
          throw err;
        }
        if (payment.allocatedAmount <= 0 || !payment.invoiceId) {
          const err: any = new Error("Payment has no allocation to reverse.");
          err.code = "BAD_REQUEST";
          err.status = 400;
          throw err;
        }

        await payments.updateOne(
          { _id: paymentOid },
          { $set: { allocatedAmount: 0, status: "Unallocated", updatedAt: new Date() } },
          { session },
        );

        const now = new Date();
        const invoices = await collection("invoices");
        const invoice = await invoices.findOne({ _id: payment.invoiceId }, { session });
        if (invoice) {
          const allocated = await (await collection("payments"))
            .aggregate([
              { $match: { invoiceId: payment.invoiceId, status: { $nin: ["Refunded", "Void"] }, _id: { $ne: paymentOid } } },
              { $group: { _id: null, total: { $sum: "$allocatedAmount" } } },
            ], { session })
            .toArray();
          const alreadyAllocated = allocated[0]?.total ?? 0;
          const invoiceTotal = Number(invoice.total ?? 0);
          let invStatus = invoice.status;
          if (alreadyAllocated <= 0) invStatus = "Draft";
          else if (alreadyAllocated >= invoiceTotal && invoiceTotal > 0) invStatus = "Paid";
          else if (alreadyAllocated > 0) invStatus = "Part Paid";
          await invoices.updateOne(
            { _id: payment.invoiceId },
            { $set: { status: invStatus, updatedAt: now } },
            { session },
          );
        }

        await writeAudit({
          actorId: actor.userId,
          actorEmail: actor.email,
          entityType: "payment",
          entityId: String(id),
          action: "allocation_reversed",
          before: { allocatedAmount: payment.allocatedAmount, status: payment.status },
          after: { allocatedAmount: 0, status: "Unallocated" },
        });
      });
    } catch (err: any) {
      await session.endSession().catch(() => {});
      return NextResponse.json(
        { error: { code: err.code ?? "SERVER_ERROR", message: err.message ?? "Reversal failed." } },
        { status: err.status ?? 500 },
      );
    } finally {
      await session.endSession().catch(() => {});
    }

    return NextResponse.json({ ok: true, id: String(paymentOid) });
  },
);
