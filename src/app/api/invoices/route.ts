/**
 * GET /api/invoices — list invoices
 * POST /api/invoices — create invoice
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId, toObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const GET = withAuth("finance.view",
  async (req) => {
    const invoices = await collection("invoices");
    const docs = await invoices.find().sort({ createdAt: -1 }).toArray();
    const invoiceList = docs.map((d: any) => ({
      id: String(d._id),
      orderId: String(d.orderId),
      invoiceNumber: d.invoiceNumber,
      total: d.total,
      status: d.status,
      dueDate: d.dueDate,
    }));
    return NextResponse.json({ invoices: invoiceList });
  },
);

export const POST = withAuth("finance.manage",
  async (req) => {
    const actor = (req as AuthedRequest).auth!;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const { orderId, total, dueDate } = body;
    if (!orderId || !total || !dueDate)
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing fields." } }, { status: 400 });

    const orderOid = safeObjectId(orderId);
    if (!orderOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid order id." } }, { status: 400 });
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: orderOid });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    const resultColl = await collection("invoices");
    const result = await resultColl.insertOne({
      orderId: orderOid,
      invoiceNumber: `INV-${Date.now()}`,
      total: Number(total),
      dueDate: new Date(dueDate),
      status: "Draft",
      createdAt: new Date(),
    });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "invoice",
      entityId: String(result.insertedId),
      action: "create",
      before: null,
      after: { orderId, total: Number(total), dueDate, status: "Draft" },
    });

    return NextResponse.json({ invoice: { id: String(result.insertedId) } }, { status: 201 });
  },
);