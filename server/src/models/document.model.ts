import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

import type { DocumentStatus } from "../types/workflow.js";

/**
 * A received file: one row per (order, type, version).
 *
 * ## Versions supersede, never overwrite (Spec §8)
 *
 * Every upload of the same document type creates a new version with its own
 * storage key. The previous version keeps its bytes and its status; it is
 * marked `Superseded` only once a replacement exists. An approved document is
 * therefore never silently replaced — the audit trail and the file stay in step.
 *
 * ## The storage key is server-only
 *
 * `storageKey` is how the file is fetched from object storage, and the raw key
 * is never returned by the API (BACKEND-PLAN §6: "raw storage key never reaches
 * client"). Clients get a presigned URL instead, so a key cannot be guessed or
 * enumerated across clients.
 */
export interface DocumentAttrs {
  orderId: Types.ObjectId;
  clientId: Types.ObjectId;
  type: string;
  version: number;
  /** Object-storage key. Never serialised into an API response. */
  storageKey: string;
  status: DocumentStatus;
  receivedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: Types.ObjectId | null;
  rejectionReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<DocumentAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    type: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    storageKey: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: [
        "Requested",
        "Not Received",
        "Received",
        "Under Review",
        "Approved",
        "Rejected",
        "Superseded",
      ],
      default: "Requested",
    },
    receivedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

// One row per (order, type, version) — a version number is only unique within
// its document type, so the triple is the identity.
documentSchema.index({ orderId: 1, type: 1, version: 1 }, { unique: true });
documentSchema.index({ orderId: 1, status: 1 });
documentSchema.index({ clientId: 1 });

export type DocumentDoc = HydratedDocument<DocumentAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type DocumentLean = DocumentAttrs & { _id: Types.ObjectId };

export const Document: Model<DocumentAttrs> = model<DocumentAttrs>("Document", documentSchema);

/**
 * Who looked at what, and when (BACKEND-PLAN B4 "document access logging").
 *
 * A separate collection from the document itself because access is a stream of
 * events — a passport scan may be downloaded a dozen times — and because the
 * retention question ("how long do we keep access records?") is different from
 * the document question ("how long do we keep the file?").
 *
 * Append-only by the same reasoning as `audit_logs`: an access record that can
 * be rewritten is not evidence.
 */
export interface DocumentAccessLogAttrs {
  documentId: Types.ObjectId;
  actorId: Types.ObjectId | null;
  action: "upload" | "download" | "review";
  ip: string | null;
  requestId: string | null;
  createdAt: Date;
}

const documentAccessLogSchema = new Schema<DocumentAccessLogAttrs>(
  {
    documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true, enum: ["upload", "download", "review"] },
    ip: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

documentAccessLogSchema.index({ documentId: 1, createdAt: -1 });
documentAccessLogSchema.index({ actorId: 1, createdAt: -1 });

export type DocumentAccessLogDoc = HydratedDocument<DocumentAccessLogAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type DocumentAccessLogLean = DocumentAccessLogAttrs & { _id: Types.ObjectId };

export const DocumentAccessLog: Model<DocumentAccessLogAttrs> = model<DocumentAccessLogAttrs>(
  "DocumentAccessLog",
  documentAccessLogSchema,
);
