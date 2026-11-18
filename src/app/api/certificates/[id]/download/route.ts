/**
 * GET /api/certificates/[id]/download — securely download a certificate file.
 * No public URLs; access is order-scoped via checkOrderAccess.
 */

import { NextResponse } from "next/server";
import { withAuth, checkOrderAccess, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeDocumentAccessLog } from "@/lib/audit";

export const GET = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const actor = (req as AuthedRequest).auth!;
    const certId = safeObjectId(resolvedParams?.id);
    if (!certId) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid certificate id." } }, { status: 400 });
    }

    const certs = await collection("certificates");
    const cert = await certs.findOne({ _id: certId });
    if (!cert) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Certificate not found." } }, { status: 404 });

    const file = cert.file;
    if (!file || !file.data) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "No certificate file available." } }, { status: 404 });
    }

    const orderOid = safeObjectId(cert.orderId);
    const order = orderOid ? await (await collection("orders")).findOne({ _id: orderOid }) : null;
    if (!checkOrderAccess(actor, order ?? {})) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this certificate." } }, { status: 403 });
    }

    await writeDocumentAccessLog({
      documentId: String(certId),
      actorId: actor.userId,
      action: "download",
      ip: req.headers.get("x-forwarded-for") ?? null,
      requestId: req.headers.get("x-request-id") ?? null,
    });

    return new NextResponse(file.data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Length": String(file.sizeBytes),
      },
    });
  },
);
