/**
 * GET /api/orders/[id]/payment-plan — the plan for one order, if it has one.
 * POST /api/orders/[id]/payment-plan — create the plan for an order.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("finance.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const plansColl = await collection("payment-plans");
    const plans = await plansColl.find({ orderId: toObjectId(id) }).toArray();
    if (plans.length === 0) return NextResponse.json({ plan: null });
    return NextResponse.json({ plan: plans[0] });
  },
);

export const POST = withAuth("finance.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const { total } = await req.json();
    if (!total || !Number.isFinite(total) || total <= 0) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Total must be a positive number." } }, { status: 400 });
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: toObjectId(id) });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    const existingColl = await collection("payment-plans");
    const existing = await existingColl.findOne({ orderId: toObjectId(id) });
    if (existing) return NextResponse.json({ error: { code: "CONFLICT", message: "This order already has a payment plan." } }, { status: 409 });

    const now = new Date();
    const planColl = await collection("payment-plans");
    const plan = await planColl.insertOne({
      orderId: toObjectId(id),
      total: Number(total),
      instalments: [],
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ plan: { id: String(plan.insertedId), total: Number(total), instalments: [] } }, { status: 201 });
  },
);