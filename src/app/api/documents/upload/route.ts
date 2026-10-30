/**
 * POST /api/documents/upload — multipart upload, store bytes in MongoDB
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

const ALLOWED: Record<string, { maxBytes: number }> = {
  "application/pdf": { maxBytes: 20 * 1024 * 1024 },
  "image/jpeg": { maxBytes: 10 * 1024 * 1024 },
  "image/png": { maxBytes: 10 * 1024 * 1024 },
  "image/webp": { maxBytes: 10 * 1024 * 1024 },
  "text/csv": { maxBytes: 20 * 1024 * 1024 },
  "text/plain": { maxBytes: 5 * 1024 * 1024 },
};

export const POST = withAuth("documents.view",
  async (req) => {
    const formData = await req.formData();
    const orderId = formData.get("orderId") as string;
    const clientId = formData.get("clientId") as string;
    const type = formData.get("type") as string;
    const file = formData.get("file") as File;

    if (!orderId || !clientId || !type || !file) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing fields." } }, { status: 400 });
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
      orderId: toObjectId(orderId),
      clientId: toObjectId(clientId),
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

    return NextResponse.json({ id: String(result.insertedId), version: nextVersion }, { status: 201 });
  },
);
