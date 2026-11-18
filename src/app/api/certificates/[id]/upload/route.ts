/**
 * POST /api/certificates/[id]/upload — upload a certificate file for an order's certificate.
 * Stores file bytes in MongoDB (same convention as documents), links to the certificate record.
 * Requires `documents.view` (or `documents.manage`) and order access.
 */

import { NextResponse } from "next/server";
import { withAuth, checkOrderAccess, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId, ObjectId } from "@/lib/db";
import { writeAudit, writeDocumentAccessLog } from "@/lib/audit";

const ALLOWED_CERT_TYPES: Record<string, { maxBytes: number }> = {
  "application/pdf": { maxBytes: 20 * 1024 * 1024 },
  "image/jpeg": { maxBytes: 10 * 1024 * 1024 },
  "image/png": { maxBytes: 10 * 1024 * 1024 },
  "image/webp": { maxBytes: 10 * 1024 * 1024 },
};

export const POST = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const actor = (req as AuthedRequest).auth!;
    const certId = safeObjectId(resolvedParams?.id);
    if (!certId) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid certificate id." } }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "File is required." } }, { status: 400 });
    }

    const certs = await collection("certificates");
    const cert = await certs.findOne({ _id: certId });
    if (!cert) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Certificate not found." } }, { status: 404 });
    }

    const orderOid = safeObjectId(cert.orderId);
    if (!orderOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid order id on certificate." } }, { status: 400 });
    }
    const order = await (await collection("orders")).findOne({ _id: orderOid });
    if (!order) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Parent order not found." } }, { status: 404 });
    }
    if (!checkOrderAccess(actor, order)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this order." } }, { status: 403 });
    }

    const contentType = file.type;
    const allowed = ALLOWED_CERT_TYPES[contentType];
    if (!allowed) {
      return NextResponse.json({ error: { code: "UNSUPPORTED_TYPE", message: `File type ${contentType} not allowed.` } }, { status: 422 });
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > allowed.maxBytes) {
      return NextResponse.json({ error: { code: "FILE_TOO_LARGE", message: "File too large." } }, { status: 422 });
    }

    // Supersede any prior file on this certificate.
    await certs.updateMany({ _id: certId, "file.id": { $ne: null } }, { $set: { "file.superseded": true } });

    await certs.updateOne({ _id: certId }, {
      $set: {
        "file": {
          id: String(new ObjectId()),
          fileName: file.name,
          contentType,
          sizeBytes: bytes.byteLength,
          data: Buffer.from(bytes),
          uploadedAt: new Date(),
          uploadedBy: actor.userId,
          superseded: false,
        },
        status: "Certificate File Received",
        updatedAt: new Date(),
      },
    });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "certificate",
      entityId: String(certId),
      action: "upload",
      before: { status: cert.status },
      after: { status: "Certificate File Received", fileName: file.name, contentType },
    });

    await writeDocumentAccessLog({
      documentId: String(certId),
      actorId: actor.userId,
      action: "upload",
      ip: req.headers.get("x-forwarded-for") ?? null,
      requestId: req.headers.get("x-request-id") ?? null,
    });

    return NextResponse.json({ ok: true, certificateId: String(certId) }, { status: 201 });
  },
);
