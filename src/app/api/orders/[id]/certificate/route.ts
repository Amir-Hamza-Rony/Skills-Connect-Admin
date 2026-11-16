/**
 * GET /api/orders/[id]/certificate — certificate record for an order
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";
import { checkOrderAccess } from "@/middleware/auth";

export const GET = withAuth("orders.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const auth = (req as AuthedRequest).auth!;
    const orders = await collection("orders");
    const order = await orders.findOne({ _id: toObjectId(id) });
    if (!order) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });
    }
    if (!checkOrderAccess(auth, order)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this order." } }, { status: 403 });
    }
    const certsColl = await collection("certificates");
    const cert = await certsColl.findOne({ orderId: toObjectId(id) });
    if (!cert) return NextResponse.json({ status: "Not Issued" });
    return NextResponse.json({ status: cert.status, certificateNumber: cert.certificateNumber, issuedAt: cert.issuedAt });
  },
);