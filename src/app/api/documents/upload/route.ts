/**
 * POST /api/documents/upload — multipart upload, store bytes in MongoDB
 */

import { NextResponse } from "next/server";
import { withAuth, checkOrderAccess, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeDocumentAccessLog } from "@/lib/audit";

const ALLOWED: Record<string, { maxBytes: number }> = {
  "application/pdf": { maxBytes: 20 * 1024 * 1024 },
  "image/jpeg": { maxBytes: 10 * 1024 * 1024 },
  "image/png": { maxBytes: 10 * 1024 * 1024 },
  "image/webp": { maxBytes: 10 * 1024 * 1024 },
  "text/csv": { maxBytes: 20 * 1024 * 1024 },
  "text/plain": { maxBytes: 5 * 1024 * 1024 },
};

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const actor = (req as AuthedRequest).auth!;
    const formData = await req.formData();
    const orderId = formData.get("orderId") as string;
    const clientId = formData.get("clientId") as string;
    const type = formData.get("type") as string;
    const file = formData.get("file") as File;

    if (!orderId || !clientId || !type || !file) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing fields." } }, { status: 400 });
    }

    // --- Ownership protection: resolve and authorize the parent order ---
    // No client-supplied owner or authorization flag is consulted.
    const orderOid = safeObjectId(orderId);
    if (!orderOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid order id." } }, { status: 400 });
    }
    const clientOid = safeObjectId(clientId);
    if (!clientOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid client id." } }, { status: 400 });
    }
    const order = await (await collection("orders")).findOne({ _id: orderOid });
    if (!order) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Parent order not found." } }, { status: 404 });
    }
    if (!checkOrderAccess(actor, order)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this order." } }, { status: 403 });
    }
    if (String(order.clientId) !== String(clientOid)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "clientId does not match the order." } }, { status: 400 });
    }

    const contentType = file.type;
    const allowed = ALLOWED[contentType];
    if (!allowed) {
      return NextResponse.json({ error: { code: "UNSUPPORTED_TYPE", message: `File type ${contentType} not allowed.` } }, { status: 422 });
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > allowed.maxBytes) {
      return NextResponse.json({ error: { code: "FILE_TOO_LARGE", message: "File too large." } }, { status: 422 });
    }

    const docs = await collection("documents");
    const existing = await docs.find({ orderId, type }).sort({ version: -1 }).limit(1).toArray();
    const nextVersion = existing.length > 0 ? (existing[0].version ?? 0) + 1 : 1;

    await docs.updateMany({ orderId, type, status: { $ne: "Superseded" } }, { $set: { status: "Superseded" } });

    const result = await docs.insertOne({
      orderId: orderOid,
      clientId: clientOid,
      type,
      version: nextVersion,
      fileName: file.name,
      contentType,
      sizeBytes: bytes.byteLength,
      data: Buffer.from(bytes),
      status: "Received",
      receivedAt: new Date(),
      createdAt: new Date(),
    });

    const documentId = String(result.insertedId);
    await writeDocumentAccessLog({
      documentId,
      actorId: actor.userId,
      action: "upload",
      ip: req.headers.get("x-forwarded-for") ?? null,
      requestId: req.headers.get("x-request-id") ?? null,
    });

    return NextResponse.json({ id: documentId, version: nextVersion }, { status: 201 });
  },
);
