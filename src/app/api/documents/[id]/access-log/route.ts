/**
 * GET /api/documents/[id]/access-log — who looked at this document (requires documents.review)
 * Mirrors Express `GET /documents/:id/access-log`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("documents.review",
  async (req: NextRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    let documentId;
    try {
      documentId = toObjectId(id);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid document id." } },
        { status: 400 },
      );
    }

    const logs = await collection("document_access_logs");
    const rows = await logs
      .find({ documentId })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({
      events: rows.map((r: any) => ({
        id: String(r._id),
        actorId: r.actorId ? String(r.actorId) : null,
        action: r.action,
        ip: r.ip,
        requestId: r.requestId,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      })),
    });
  },
);
