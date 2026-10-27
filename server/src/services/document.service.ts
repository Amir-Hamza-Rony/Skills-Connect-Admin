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
import { getStorage } from "../integrations/storage/s3.js";
import { recordAudit } from "./audit.service.js";

export interface ActorMeta {
  id: string;
  email: string;
  ip?: string | null;
  requestId?: string | null;
}

/**
 * Document DTO — deliberately excludes `storageKey`.
 *
 * The key is how a file is fetched from object storage. Sending it to the browser
 * would let a client enumerate other clients' files by guessing paths, which is
 * the exact thing presigned URLs exist to prevent. Every response that returns a
 * document goes through `toDocumentDTO`, so the omission is structural rather
 * than a convention someone has to remember.
 */
export type DocumentDTO = Omit<DocumentAttrs, "storageKey" | "orderId" | "clientId"> & {
  id: string;
  orderId: string;
  clientId: string;
};

export function toDocumentDTO(doc: DocumentLean): DocumentDTO {
  const { storageKey: _storageKey, ...rest } = doc;
  return {
    ...rest,
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

/**
 * Builds the storage key for a version.
 *
 * The path mirrors the business hierarchy — client → order → type → version — so
 * a listing in the bucket is readable by a human, and the type is sanitised
 * because it is free text from a form.
 */
function storageKeyFor(clientId: string, orderId: string, type: string, version: number): string {
  const slug = type
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `clients/${clientId}/orders/${orderId}/${slug}/v${version}`;
}

export interface UploadUrlResult {
  uploadUrl: string;
  document: DocumentDTO;
}

/**
 * `POST /documents/upload-url`
 *
 * Creates the document row for a new version and returns a presigned PUT URL.
 *
 * The version number is computed here, not sent by the client, so two
 * concurrent uploads cannot collide on the same version and a client cannot
 * request "version 1" to overwrite an approved document.
 *
 * The document starts life as `Not Received`: the row exists so the client has
 * something to show and the key is reserved, but nothing claims the file is
 * there until `confirmUpload` checks the bucket.
 */
export async function requestUploadUrl(
  orderId: string,
  type: string,
  contentType: string,
  actor: ActorMeta,
): Promise<UploadUrlResult> {
  const storage = getStorage();
  if (!storage) throw AppError.unprocessable("STORAGE_NOT_CONFIGURED", storageMessage());

  if (!Types.ObjectId.isValid(orderId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid order id.");
  }

  const order = await Order.findById(orderId).lean();
  if (!order) throw AppError.notFound("Order not found.");

  // The version is computed from what already exists, so two concurrent
  // uploads of the same type can both read "no prior versions" and both try to
  // create version 1. The unique index on (orderId, type, version) turns the
  // second into a duplicate-key error; recomputing and retrying resolves it
  // instead of surfacing a 500 to the client.
  let doc: DocumentDoc | undefined;
  for (let attempt = 0; attempt < 5 && !doc; attempt += 1) {
    const prior = await Document.find({ orderId: order._id, type }).lean<DocumentLean[]>();
    const version = prior.length === 0 ? 1 : Math.max(...prior.map((d) => d.version)) + 1;
    const storageKey = storageKeyFor(String(order.clientId), orderId, type, version);

    try {
      doc = await Document.create({
        orderId: order._id,
        clientId: order.clientId,
        type,
        version,
        storageKey,
        contentType,
        sizeBytes: null,
        status: "Not Received",
        receivedAt: null,
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
  // document is never silently overwritten. The replacement must be reviewed on
  // its own merits.
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

  // Signed after the row exists so the URL always matches the stored key, even
  // when a retry bumped the version.
  const uploadUrl = await storage.presignUpload(doc.storageKey, contentType);

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
    action: "document.upload-url",
    entityType: "document",
    entityId: String(doc._id),
    after: { orderId, type, version: doc.version, contentType },
  });

  return { uploadUrl, document: toDocumentDTO(doc.toObject() as DocumentLean) };
}

/**
 * `POST /documents/:id/confirm-upload`
 *
 * Marks a document received, but only if the object is actually in the bucket.
 *
 * Trusting the client's word would let someone mark a document received without
 * uploading it, and the whole review workflow downstream is built on "received"
 * meaning a file exists. A `HeadObject` call is cheap and settles it.
 *
 * The same HEAD gives the real byte count, which is the only trustworthy size:
 * the browser's claim is unverified because the bytes never pass through the
 * API. An oversized or empty object is rejected here rather than sitting in the
 * review queue until a human notices.
 */
export async function confirmUpload(
  documentId: string,
  actor: ActorMeta,
): Promise<DocumentDTO> {
  const doc = await Document.findById(documentId);
  if (!doc) throw AppError.notFound("Document not found.");

  const storage = getStorage();
  // Distinguish "storage is not configured" from "the file is missing". Both
  // used to surface as UPLOAD_NOT_FOUND, which told the operator their upload
  // had gone missing when in fact nothing had ever been configured.
  if (!storage) {
    throw AppError.unprocessable(
      "STORAGE_NOT_CONFIGURED",
      "Document storage is not configured, so uploads cannot be confirmed.",
    );
  }

  const sizeBytes = await storage.objectSize(doc.storageKey);
  if (sizeBytes === null) {
    throw AppError.unprocessable(
      "UPLOAD_NOT_FOUND",
      "No file found at this document's storage location. Upload it before confirming.",
    );
  }

  const allowed = allowedUpload(doc.contentType);
  const cap = allowed?.maxBytes ?? MAX_UPLOAD_BYTES;
  if (sizeBytes > cap) {
    throw AppError.unprocessable(
      "FILE_TOO_LARGE",
      `The uploaded file is ${Math.round(sizeBytes / (1024 * 1024))} MB, over the ${Math.round(cap / (1024 * 1024))} MB limit for ${allowed?.label ?? "this file type"}.`,
    );
  }
  if (sizeBytes === 0) {
    throw AppError.unprocessable("FILE_EMPTY", "The uploaded file is empty.");
  }

  doc.status = "Received";
  doc.receivedAt = new Date();
  doc.sizeBytes = sizeBytes;
  await doc.save();

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "document.received",
    entityType: "document",
    entityId: String(doc._id),
    after: { status: "Received", receivedAt: doc.receivedAt },
  });

  return toDocumentDTO(doc.toObject() as DocumentLean);
}

/**
 * `GET /documents/:id/download-url`
 *
 * Returns a presigned GET URL and writes an access-log row.
 *
 * The log is written even though the file itself never touches the API — that is
 * the point of the feature: "who looked at this client's passport scan" is a
 * question the business can answer after the fact.
 */
export async function requestDownloadUrl(
  documentId: string,
  actor: ActorMeta,
): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  const doc = await Document.findById(documentId);
  if (!doc) throw AppError.notFound("Document not found.");

  const storage = getStorage();
  if (!storage) throw AppError.unprocessable("STORAGE_NOT_CONFIGURED", storageMessage());

  if (doc.status === "Not Received" || doc.status === "Requested") {
    throw AppError.unprocessable(
      "NOT_RECEIVED",
      "This document has not been received yet, so there is no file to download.",
    );
  }

  const downloadUrl = await storage.presignDownload(doc.storageKey);

  await recordAccessLog({
    documentId: doc._id,
    actorId: actor.id,
    action: "download",
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  return { downloadUrl, expiresInSeconds: 15 * 60 };
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

function storageMessage(): string {
  return "Object storage is not configured. Set S3_BUCKET in server/.env.";
}
