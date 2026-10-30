/**
 * GET /api/orders/[id]/certificate — certificate record for an order
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("orders.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const certsColl = await collection("certificates");
    const cert = await certsColl.findOne({ orderId: toObjectId(id) });
    if (!cert) return NextResponse.json({ status: "Not Issued" });
    return NextResponse.json({ status: cert.status, certificateNumber: cert.certificateNumber, issuedAt: cert.issuedAt });
  },
);