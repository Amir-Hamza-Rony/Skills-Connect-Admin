/**
 * GET /api/orders/[id]/documents — list documents for a specific order
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";

export const GET = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const oid = safeObjectId(id);
    if (!oid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid order id." } }, { status: 400 });
    }

    const coll = await collection("documents");
    const docs = await coll
      .find({ orderId: oid })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({
      documents: docs.map((d: any) => ({
        id: String(d._id),
        orderId: String(d.orderId),
        clientId: String(d.clientId),
        type: d.type,
        version: d.version,
        fileName: d.fileName,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        status: d.status,
        receivedAt: d.receivedAt,
        reviewedAt: d.reviewedAt,
        reviewedBy: d.reviewedBy,
        rejectionReason: d.rejectionReason,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  },
);
