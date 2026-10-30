/**
 * GET /api/orders/[id] — single order with detail
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("orders.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const orders = await collection("orders");
    const order = await orders.findOne({ _id: toObjectId(id) });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    const margin = order.sellingPrice - order.supplierCostSnapshot - (order.otherCost ?? 0);
    return NextResponse.json({
      id: String(order._id),
      clientId: String(order.clientId),
      qualificationId: String(order.qualificationId),
      salesAgentId: String(order.salesAgentId),
      sourceAgentId: String(order.sourceAgentId),
      rtoId: String(order.rtoId),
      status: order.status,
      evidenceStatus: order.evidenceStatus,
      rtoSubmissionStatus: order.rtoSubmissionStatus,
      certificateStatus: order.certificateStatus,
      sellingPrice: order.sellingPrice,
      supplierCostSnapshot: order.supplierCostSnapshot,
      otherCost: order.otherCost,
      grossMargin: margin,
      currency: order.currency,
      history: order.history ?? [],
      createdAt: order.createdAt,
    });
  },
);