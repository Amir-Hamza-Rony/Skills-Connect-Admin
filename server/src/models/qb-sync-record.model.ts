import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * The QuickBooks sync queue (BACKEND-PLAN §5 `qb_sync_records`).
 *
 * ## Idempotency is the whole point
 *
 * Every record carries an `idempotencyKey` derived from the entity, and that key
 * is unique. A retried job reuses the same key, so QuickBooks sees one create
 * per entity no matter how many times the worker runs — the "same key = no
 * duplicates" criterion. The unique index is what enforces it: a second insert
 * with the same key is rejected rather than creating a second QB record.
 *
 * ## Status flow
 *
 * `Not Synced` → `Pending` → `Synced`, with `Failed` reachable from any state
 * and retryable back to `Synced`. A failure records the error and the attempt
 * count so the UI can show "failed after 3 attempts" rather than just "failed".
 */
export type QBSyncStatus = "Not Synced" | "Pending" | "Synced" | "Failed";

export interface QBSyncRecordAttrs {
  entityType: "invoice" | "payment";
  entityId: Types.ObjectId;
  idempotencyKey: string;
  status: QBSyncStatus;
  attempts: number;
  lastSyncAt: Date | null;
  syncError: string | null;
  qbReference: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const qbSyncRecordSchema = new Schema<QBSyncRecordAttrs>(
  {
    entityType: { type: String, required: true, enum: ["invoice", "payment"] },
    entityId: { type: Schema.Types.ObjectId, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    status: {
      type: String,
      required: true,
      enum: ["Not Synced", "Pending", "Synced", "Failed"],
      default: "Not Synced",
    },
    attempts: { type: Number, required: true, min: 0, default: 0 },
    lastSyncAt: { type: Date, default: null },
    syncError: { type: String, default: null },
    qbReference: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

qbSyncRecordSchema.index({ entityType: 1, entityId: 1 });
qbSyncRecordSchema.index({ status: 1 });

export type QBSyncRecordDoc = HydratedDocument<QBSyncRecordAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type QBSyncRecordLean = QBSyncRecordAttrs & { _id: Types.ObjectId };

export const QBSyncRecord: Model<QBSyncRecordAttrs> = model<QBSyncRecordAttrs>(
  "QBSyncRecord",
  qbSyncRecordSchema,
);
