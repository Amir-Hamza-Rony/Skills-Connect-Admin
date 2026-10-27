import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * Append-only audit trail (architecture.md §1.4). Records actor, entity,
 * before -> after, timestamp and IP for every status, financial, document and
 * RTO-route change.
 *
 * Two guards make "append-only" real rather than a convention:
 *  1. Pre-hooks throw on every update and delete verb.
 *  2. `recordAuditLog()` is the only write path this module exports.
 *
 * `actorEmail` is denormalised so the trail stays readable even if the user is
 * later deactivated or removed — an audit row must never become unattributable.
 */
export interface AuditLogAttrs {
  actorId?: Types.ObjectId | null;
  actorEmail?: string | null;

  action: string;
  entityType: string;
  entityId?: string | null;

  before?: unknown;
  after?: unknown;

  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;

  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogAttrs>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorEmail: { type: String, default: null },

    action: { type: String, required: true, trim: true },
    entityType: { type: String, required: true, trim: true },
    entityId: { type: String, default: null },

    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

const BLOCKED =
  "audit_logs is append-only — updates and deletes are blocked by design (architecture.md §1.4)";

for (const verb of [
  "updateMany",
  "deleteMany",
  "findOneAndDelete",
  "findOneAndUpdate",
  "updateOne",
  "deleteOne",
  "replaceOne",
] as const) {
  auditLogSchema.pre(verb, function () {
    throw new Error(BLOCKED);
  });
}

export type AuditLogDoc = HydratedDocument<AuditLogAttrs>;
export type AuditLogLean = AuditLogAttrs & { _id: Types.ObjectId };

export const AuditLog: Model<AuditLogAttrs> = model<AuditLogAttrs>("AuditLog", auditLogSchema);

/**
 * The only write path. A standalone function rather than a model static so the
 * append-only intent is visible at every call site.
 */
export function recordAuditLog(
  entry: Omit<AuditLogAttrs, "createdAt">,
): Promise<AuditLogDoc> {
  return AuditLog.create(entry);
}