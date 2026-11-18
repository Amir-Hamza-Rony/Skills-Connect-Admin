/**
 * GET /api/documents/[id]/download — stream file bytes
 */

import { NextResponse } from "next/server";
import { withAuth, checkOrderAccess, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeDocumentAccessLog } from "@/lib/audit";

export const GET = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const actor = (req as AuthedRequest).auth!;
    const docOid = safeObjectId(id);
    if (!docOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid document id." } }, { status: 400 });
    }
    const docs = await collection("documents");
    const doc = await docs.findOne({ _id: docOid });
    if (!doc) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });

    // --- Ownership protection: authorize against the parent order before
    // exposing bytes or metadata. Missing/ownerless orders fail closed;
    // admins retain access. ---
    const orderOid = safeObjectId(doc.orderId);
    const order = orderOid ? await (await collection("orders")).findOne({ _id: orderOid }) : null;
    if (!checkOrderAccess(actor, order ?? {})) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this document." } }, { status: 403 });
    }

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