import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { MAX_UPLOAD_BYTES, allowedUpload } from "../lib/uploads.js";
import { logger } from "../lib/logger.js";
import {
  Document,
  type DocumentDoc,
  DocumentAccessLog,
  type DocumentAccessLogAttrs,
  type DocumentAttrs,
  type DocumentLean,
} from "../models/document.model.js";
import { Order } from "../models/order.model.js";
import { recordAudit } from "./audit.service.js";

export interface ActorMeta {
  id: string;
  email: string;
  ip?: string | null;
  requestId?: string | null;
}

/**
 * Document DTO — deliberately excludes `data` (the raw file bytes).
 *
 * The file binary lives in MongoDB and is served through
 * `GET /documents/:id/download`. The browser never receives the raw Buffer;
 * it receives metadata plus a download endpoint it can fetch.
 * Every response that returns a document goes through `toDocumentDTO`,
 * so the omission is structural rather than a convention someone has to remember.
 */
export type DocumentDTO = Omit<DocumentAttrs, "data" | "orderId" | "clientId"> & {
  id: string;
  orderId: string;
  clientId: string;
};

export function toDocumentDTO(doc: DocumentLean): DocumentDTO {
  const { data: _data, ...rest } = doc;
  return {
    ...rest,
    sizeBytes: rest.sizeBytes ?? 0,
    id: String(doc._id),
    orderId: String(doc.orderId),
    clientId: String(doc.clientId),
  };
}

/** `GET /orders/:id/documents` */
export async function listDocuments(orderId: string): Promise<DocumentDTO[]> {
  if (!Types.ObjectId.isValid(orderId)) return [];
  const docs = await Document.find({ orderId: new Types.ObjectId(orderId) })
    .sort({ type: 1, version: -1 })
    .lean<DocumentLean[]>();
  return docs.map(toDocumentDTO);
}

/** `GET /documents/:id/data` — returns the stored file binary for download. */
export async function getDocumentData(documentId: string): Promise<{
  data: Buffer;
  fileName: string;
  contentType: string;
}> {
  if (!Types.ObjectId.isValid(documentId)) {
    throw AppError.notFound("Document not found.");
  }
  const doc = await Document.findById(documentId)
    .select("data fileName contentType status")
    .lean<DocumentLean>();
  if (!doc) throw AppError.notFound("Document not found.");
  if (doc.status === "Not Received" || doc.status === "Requested") {
    throw AppError.unprocessable(
      "NOT_RECEIVED",
      "This document has not been received yet, so there is no file to download.",
    );
  }
  return {
    data: doc.data ?? Buffer.alloc(0),
    fileName: doc.fileName,
    contentType: doc.contentType,
  };
}

/**
 * `POST /documents/upload`
 *
 * Accepts `multipart/form-data` with fields: `file` (the file), `orderId`,
 * `type`. The server stores the file bytes directly in MongoDB — no object
 * storage, no presigned URLs, no S3 bucket.
 *
 * Needs `documents.view` rather than `documents.review` because uploading is
 * part of collecting documents, not judging them — a sales agent gathering
 * evidence should be able to upload without also being able to approve.
 *
 * A new version makes the previous ones historical. Their bytes and their
 * review outcomes are preserved — only the status changes — so an approved
 * document is never silently overwritten. The replacement must be reviewed
 * on its own merits.
 */
export interface UploadResult {
  document: DocumentDTO;
}

export async function uploadDocument(
  orderId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  type: string,
  actor: ActorMeta,
): Promise<UploadResult> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid order id.");
  }

  const order = await Order.findById(orderId).lean();
  if (!order) throw AppError.notFound("Order not found.");

  const allowed = allowedUpload(file.mimetype);
  if (!allowed) {
    throw AppError.unprocessable(
      "CONTENT_TYPE_NOT_ALLOWED",
      `"${file.mimetype}" is not an accepted document type.`,
    );
  }
  if (file.size > allowed.maxBytes) {
    throw AppError.unprocessable(
      "FILE_TOO_LARGE",
      `${allowed.label} files must be under ${Math.round(allowed.maxBytes / (1024 * 1024))} MB.`,
    );
  }
  if (file.size === 0) {
    throw AppError.unprocessable("FILE_EMPTY", "The uploaded file is empty.");
  }

  // The version is computed from what already exists, so two concurrent
  // uploads of the same type can both read "no prior versions" and both try to
  // create version 1. The unique index on (orderId, type, version) turns the
  // second into a duplicate-key error; recomputing and retrying resolves it
  // instead of surfacing a 500 to the client.
  let doc: DocumentDoc | undefined;
  for (let attempt = 0; attempt < 5 && !doc; attempt += 1) {
    const prior = await Document.find({ orderId: order._id, type }).lean<DocumentLean[]>();
    const version = prior.length === 0 ? 1 : Math.max(...prior.map((d) => d.version)) + 1;

    try {
      doc = await Document.create({
        orderId: order._id,
        clientId: order.clientId,
        type,
        version,
        fileName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        data: file.buffer,
        status: "Received",
        receivedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 11000) throw err;
      // Duplicate version — someone else inserted between our read and write.
    }
  }

  if (!doc) {
    throw AppError.unprocessable(
      "VERSION_CONFLICT",
      "Could not allocate a document version after several attempts. Please retry.",
    );
  }

  // A new version makes the previous ones historical. Their files and their
  // review outcomes are preserved — only the status changes — so an approved
  // document is never silently overwritten. The replacement must be reviewed
  // on its own merits.
  //
  // `version: { $lt: doc.version }` is the important part. Without the ceiling,
  // two concurrent uploads resolve to v1 and v2, and whichever calls this last
  // marks *both* the other one and every older version Superseded — including
  // the newer sibling — leaving the order with no active version at all and no
  // way to tell which file is current.
  await Document.updateMany(
    {
      orderId: order._id,
      type,
      status: { $ne: "Superseded" },
      _id: { $ne: doc._id },
      version: { $lt: doc.version },
    },
    { $set: { status: "Superseded" } },
  );

  await recordAccessLog({
    documentId: doc._id,
    actorId: actor.id,
    action: "upload",
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "document.upload",
    entityType: "document",
    entityId: String(doc._id),
    after: { orderId, type, version: doc.version, contentType: file.mimetype, sizeBytes: file.size },
  });

  return { document: toDocumentDTO(doc.toObject() as DocumentLean) };
}

/**
 * `PATCH /documents/:id/review`
 *
 * Approves or rejects a received document. A rejection requires a reason — the
 * client has to be told what to fix, otherwise "Rejected" is a dead end.
 */
export async function reviewDocument(
  documentId: string,
  verdict: "Approved" | "Rejected",
  reviewerId: string,
  reason: string | undefined,
  actor: ActorMeta,
): Promise<DocumentDTO> {
  const doc = await Document.findById(documentId);
  if (!doc) throw AppError.notFound("Document not found.");

  if (verdict === "Rejected" && !reason?.trim()) {
    throw AppError.badRequest("REASON_REQUIRED", "A rejection reason is required.");
  }

  if (doc.status !== "Received" && doc.status !== "Under Review") {
    throw AppError.unprocessable(
      "NOT_REVIEWABLE",
      `A document must be received before it can be reviewed (current status: ${doc.status}).`,
    );
  }

  const before = doc.status;
  doc.status = verdict;
  doc.reviewedAt = new Date();
  doc.reviewedBy = new Types.ObjectId(reviewerId);
  doc.rejectionReason = verdict === "Rejected" ? reason!.trim() : null;
  await doc.save();

  await recordAccessLog({
    documentId: doc._id,
    actorId: reviewerId,
    action: "review",
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: `document.review.${verdict.toLowerCase()}`,
    entityType: "document",
    entityId: String(doc._id),
    before: { status: before },
    after: { status: verdict, rejectionReason: doc.rejectionReason, reviewedBy: reviewerId },
  });

  return toDocumentDTO(doc.toObject() as DocumentLean);
}

/** `GET /documents/:id/access-log` — who looked at this document, and when. */
export async function accessLog(
  documentId: string,
): Promise<Array<Record<string, unknown>>> {
  if (!Types.ObjectId.isValid(documentId)) return [];
  const rows = await DocumentAccessLog.find({ documentId: new Types.ObjectId(documentId) })
    .sort({ createdAt: -1 })
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    actorId: r.actorId ? String(r.actorId) : null,
    action: r.action,
    ip: r.ip,
    requestId: r.requestId,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function recordAccessLog(
  entry: Omit<DocumentAccessLogAttrs, "createdAt" | "actorId"> & { actorId: string | null },
): Promise<void> {
  try {
    await DocumentAccessLog.create({
      documentId: entry.documentId,
      actorId: entry.actorId && Types.ObjectId.isValid(entry.actorId)
        ? new Types.ObjectId(entry.actorId)
        : null,
      action: entry.action,
      ip: entry.ip ?? null,
      requestId: entry.requestId ?? null,
    });
  } catch (err) {
    // Access logging must never block a download. Same reasoning as the audit
    // trail: a logging outage is logged, not surfaced.
    logger.error({ err, documentId: String(entry.documentId), action: entry.action }, "Access log write failed");
  }
}
