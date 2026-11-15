/**
 * GET /api/documents/[id]/download — stream file bytes
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission, type AuthedRequest } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";
import { writeDocumentAccessLog } from "@/lib/audit";

export const GET = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const actor = (req as AuthedRequest).auth!;
    const docs = await collection("documents");
    const doc = await docs.findOne({ _id: toObjectId(id) });
    if (!doc) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });

    await writeDocumentAccessLog({
      documentId: String(id),
      actorId: actor.userId,
      action: "download",
      ip: req.headers.get("x-forwarded-for") ?? null,
      requestId: req.headers.get("x-request-id") ?? null,
    });

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