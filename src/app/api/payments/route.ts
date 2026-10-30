/**
 * GET /api/payments — list payments
 * POST /api/payments — record payment
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("finance.view",
  async (req) => {
    const payments = await collection("payments");
    const docs = await payments.find().sort({ createdAt: -1 }).toArray();
    const paymentList = docs.map((d: any) => ({
      id: String(d._id),
      orderId: String(d.orderId),
      amount: d.amount,
      method: d.method,
      status: d.status,
      date: d.date,
    }));
    return NextResponse.json({ payments: paymentList });
  },
);

export const POST = withAuth("finance.manage",
  async (req) => {
    const { orderId, amount, date, method, reference, invoiceId } = await req.json();
    if (!orderId || !amount || !date || !method)
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing fields." } }, { status: 400 });

    const resultColl = await collection("payments");
    const result = await resultColl.insertOne({
      orderId: toObjectId(orderId),
      invoiceId: invoiceId ? toObjectId(invoiceId) : null,
      amount: Number(amount),
      date: new Date(date),
      method,
      reference: reference ?? "",
      allocatedAmount: Number(amount),
      status: "Allocated",
      createdAt: new Date(),
    });
    return NextResponse.json({ payment: { id: String(result.insertedId) } }, { status: 201 });
  },
);