/**
 * GET /api/documents/[id]/download — stream file bytes
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("documents.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const docs = await collection("documents");
    const doc = await docs.findOne({ _id: toObjectId(id) });
    if (!doc) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });

    return new NextResponse(doc.data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `attachment; filename="${doc.fileName}"`,
        "Content-Length": String(doc.sizeBytes),
      },
    });
  },
);