/**
 * GET /api/payments — list payments
 * POST /api/payments — record payment and allocate against an invoice
 *
 * Allocation is performed server-side in a MongoDB transaction:
 *   - the invoice and its existing allocations are read,
 *   - the requested amount is validated against the outstanding balance,
 *   - the payment is inserted and the invoice allocation status is updated
 *     atomically,
 *   - an idempotency key prevents duplicate allocations.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId, getClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

export const GET = withAuth("finance.view",
  async (req) => {
    const payments = await collection("payments");
    const docs = await payments.find().sort({ createdAt: -1 }).toArray();
    const paymentList = docs.map((d: any) => ({
      id: String(d._id),
      orderId: String(d.orderId),
      invoiceId: d.invoiceId ? String(d.invoiceId) : null,
      amount: d.amount,
      allocatedAmount: d.allocatedAmount,
      method: d.method,
      status: d.status,
      date: d.date,
    }));
    return NextResponse.json({ payments: paymentList });
  },
);

export const POST = withAuth("finance.manage",
  async (req) => {
    const actor = (req as AuthedRequest).auth!;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const { orderId, invoiceId, amount, date, method, reference, idempotencyKey } = body;

    if (!orderId || !date || !method) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Missing required fields." } },
        { status: 400 },
      );
    }

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Amount must be a positive number." } },
        { status: 400 },
      );
    }

    const orderOid = safeObjectId(orderId);
    if (!orderOid) return invalidId();

    let invoiceOid: import("mongodb").ObjectId | null = null;
    if (invoiceId) {
      invoiceOid = safeObjectId(invoiceId);
      if (!invoiceOid) return invalidId();
    }

    const validMethods = new Set(["Bank Transfer", "Card", "Cash", "Other"]);
    if (!validMethods.has(method)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid payment method." } },
        { status: 400 },
      );
    }

    const client = await getClient();
    const session = client.startSession();
    let result: any;
    try {
      await session.withTransaction(async () => {
        // Idempotency: reject a duplicate allocation keyed by idempotencyKey.
        if (idempotencyKey) {
          const paymentsColl = await collection("payments");
          const existing = await paymentsColl.findOne(
            { idempotencyKey },
            { session },
          );
          if (existing) {
            const err: any = new Error("Duplicate payment allocation.");
            err.code = "DUPLICATE_ALLOCATION";
            err.status = 409;
            throw err;
          }
        }

        // Validate the order exists.
        const orders = await collection("orders");
        const order = await orders.findOne({ _id: orderOid }, { session });
        if (!order) {
          const err: any = new Error("Order not found.");
          err.code = "NOT_FOUND";
          err.status = 404;
          throw err;
        }

        let outstanding = 0;
        let invoice: any = null;
        if (invoiceOid) {
          const invoices = await collection("invoices");
          invoice = await invoices.findOne({ _id: invoiceOid }, { session });
          if (!invoice) {
            const err: any = new Error("Invoice not found.");
            err.code = "NOT_FOUND";
            err.status = 404;
            throw err;
          }
          if (String(invoice.orderId) !== String(order._id)) {
            const err: any = new Error("Invoice does not belong to this order.");
            err.code = "BAD_REQUEST";
            err.status = 400;
            throw err;
          }

          const payments = await collection("payments");
          const allocated = await payments
            .aggregate([
              { $match: { invoiceId: invoiceOid, status: { $nin: ["Refunded", "Void"] } } },
              { $group: { _id: null, total: { $sum: "$allocatedAmount" } } },
            ], { session })
            .toArray();
          const alreadyAllocated = allocated[0]?.total ?? 0;
          outstanding = Number(invoice.total ?? 0) - alreadyAllocated;
        }

        if (invoiceOid && amountNum > outstanding) {
          const err: any = new Error(
            `Amount exceeds outstanding balance of ${outstanding}.`,
          );
          err.code = "OVER_ALLOCATION";
          err.status = 400;
          throw err;
        }

        const allocatedAmount = invoiceOid ? Math.min(amountNum, outstanding) : amountNum;
        const now = new Date();
        const payment = {
          orderId: orderOid,
          invoiceId: invoiceOid ?? null,
          amount: amountNum,
          date: new Date(date),
          method,
          reference: reference ?? "",
          allocatedAmount,
          idempotencyKey: idempotencyKey ?? null,
          status: allocatedAmount > 0 ? "Allocated" : "Unallocated",
          createdAt: now,
          updatedAt: now,
        };

        const resultColl = await collection("payments");
        const insertRes = await resultColl.insertOne(payment, { session });
        result = { id: String(insertRes.insertedId), payment };

        // Keep the invoice allocation status consistent.
        if (invoiceOid) {
          const invoices = await collection("invoices");
          const allocated2 = await invoices.aggregate([
            { $match: { _id: invoiceOid } },
            {
              $lookup: {
                from: "payments",
                let: { invoiceId: "$_id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$invoiceId", "$$invoiceId"] }, status: { $nin: ["Refunded", "Void"] } } },
                  { $group: { _id: null, total: { $sum: "$allocatedAmount" } } },
                ],
                as: "allocations",
              },
            },
            {
              $set: {
                allocatedTotal: { $ifNull: [{ $arrayElemAt: ["$allocations.total", 0] }, 0] },
              },
            },
          ], { session }).toArray();
          const inv = allocated2[0];
          const allocatedTotal = Number(inv?.allocatedTotal ?? 0);
          const invoiceTotal = Number(invoice.total ?? 0);
          let invStatus = invoice.status;
          if (allocatedTotal >= invoiceTotal && invoiceTotal > 0) invStatus = "Paid";
          else if (allocatedTotal > 0) invStatus = "Part Paid";
          await invoices.updateOne(
            { _id: invoiceOid },
            { $set: { status: invStatus, updatedAt: now } },
            { session },
          );
        }
      });
    } catch (err: any) {
      await session.endSession().catch(() => {});
      if (err.code === "NOT_FOUND" || err.code === "BAD_REQUEST" || err.code === "OVER_ALLOCATION" || err.code === "DUPLICATE_ALLOCATION") {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status ?? 400 },
        );
      }
      return NextResponse.json(
        { error: { code: "SERVER_ERROR", message: "Payment recording failed." } },
        { status: 500 },
      );
    } finally {
      await session.endSession().catch(() => {});
    }

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "payment",
      entityId: result.id,
      action: "create",
      before: null,
      after: {
        orderId,
        invoiceId,
        amount: result.payment.amount,
        allocatedAmount: result.payment.allocatedAmount,
        status: result.payment.status,
      },
    });

    return NextResponse.json({ payment: { id: result.id } }, { status: 201 });
  },
);
