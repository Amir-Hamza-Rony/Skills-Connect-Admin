/**
 * GET /api/orders/[id]/documents — document list for one order (requires documents.view)
 * Mirrors Express `GET /orders/:id/documents`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("documents.view",
  async (req: NextRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    let orderId;
    try {
      orderId = toObjectId(id);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid order id." } },
        { status: 400 },
      );
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: orderId });
    if (!order) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Order not found." } },
        { status: 404 },
      );
    }

    const docs = await collection("documents");
    const documents = await docs
      .find({ orderId })
      .sort({ type: 1, version: -1 })
      .toArray();

    return NextResponse.json({
      documents: documents.map((d: any) => ({
        id: String(d._id),
        orderId: String(d.orderId),
        clientId: String(d.clientId),
        type: d.type,
        version: d.version,
        fileName: d.fileName,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        status: d.status,
        receivedAt: d.receivedAt ?? null,
        reviewedAt: d.reviewedAt ?? null,
        reviewedBy: d.reviewedBy ? String(d.reviewedBy) : null,
        rejectionReason: d.rejectionReason ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  },
);
