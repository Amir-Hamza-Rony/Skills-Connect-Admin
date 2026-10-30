/**
 * GET /api/invoices — list invoices
 * POST /api/invoices — create invoice
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

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
    const { orderId, total, dueDate } = await req.json();
    if (!orderId || !total || !dueDate)
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing fields." } }, { status: 400 });

    const resultColl = await collection("invoices");
    const result = await resultColl.insertOne({
      orderId: toObjectId(orderId),
      invoiceNumber: `INV-${Date.now()}`,
      total: Number(total),
      dueDate: new Date(dueDate),
      status: "Draft",
      createdAt: new Date(),
    });
    return NextResponse.json({ invoice: { id: String(result.insertedId) } }, { status: 201 });
  },
);