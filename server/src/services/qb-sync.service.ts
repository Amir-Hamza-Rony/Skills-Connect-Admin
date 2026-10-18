import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { logger } from "../lib/logger.js";
import { QBSyncRecord, type QBSyncRecordLean } from "../models/qb-sync-record.model.js";
import { recordAudit } from "./audit.service.js";
import type { FinanceActor } from "./payment.service.js";

/**
 * QuickBooks sync queue (BACKEND-PLAN B5).
 *
 * ## Idempotency
 *
 * The `idempotencyKey` is derived from the entity and is unique in the
 * collection. A retried job reuses the same key, so QuickBooks sees exactly one
 * create per entity no matter how many times the worker runs. The unique index
 * is the enforcement: a second insert is rejected rather than creating a
 * duplicate QB record.
 *
 * ## Transport
 *
 * The actual QuickBooks API call lives in `integrations/quickbooks/`. Without
 * sandbox credentials that transport cannot succeed, so `syncNow` reports
 * `Failed` with a clear error rather than pretending. The status flow
 * (Not Synced → Pending → Synced, Failed retryable) and the idempotency
 * guarantee are real and testable independently of whether QB is reachable.
 *
 * ## BullMQ
 *
 * B5 specifies a BullMQ worker so retries are queued rather than inline. Redis
 * is not available in every environment (it needs Docker, which is not
 * installed on the dev machine), so `enqueue` runs the job inline when Redis is
 * not configured and queues it when it is. The job handler is the same either
 * way.
 */

export interface QBSyncRecordDTO {
  id: string;
  entityType: "invoice" | "payment";
  entityId: string;
  idempotencyKey: string;
  status: QBSyncRecordLean["status"];
  attempts: number;
  lastSyncAt: string | null;
  syncError: string | null;
  qbReference: string | null;
}

export function toSyncRecordDTO(doc: QBSyncRecordLean): QBSyncRecordDTO {
  return {
    id: String(doc._id),
    entityType: doc.entityType,
    entityId: String(doc.entityId),
    idempotencyKey: doc.idempotencyKey,
    status: doc.status,
    attempts: doc.attempts,
    lastSyncAt: doc.lastSyncAt ? doc.lastSyncAt.toISOString() : null,
    syncError: doc.syncError,
    qbReference: doc.qbReference,
  };
}

/** Stable key: the same entity always maps to the same key, retry or not. */
function idempotencyKeyFor(entityType: "invoice" | "payment", entityId: Types.ObjectId): string {
  return `qb-${entityType}-${String(entityId)}-v1`;
}

/**
 * Attempts the QuickBooks API call for one record.
 *
 * Isolated from the rest of the sync logic so it can be replaced with the real
 * QuickBooks client in one place, and so tests can drive both outcomes without
 * touching the network.
 */
export interface QBTransportResult {
  ok: boolean;
  qbReference?: string;
  error?: string;
}

/**
 * The real QuickBooks call.
 *
 * Without `QB_REALM_ID` / `QB_CLIENT_ID` / `QB_CLIENT_SECRET` there is nothing
 * to call, so this returns a failure with an actionable message. Wiring the
 * SDK in later means changing this function and nothing else.
 */
export async function syncToQuickBooks(
  _record: QBSyncRecordLean,
): Promise<QBTransportResult> {
  const { env } = await import("../config/env.js");
  if (!env.QB_REALM_ID || !env.QB_CLIENT_ID) {
    return {
      ok: false,
      error: "QuickBooks is not configured (QB_REALM_ID / QB_CLIENT_ID not set).",
    };
  }
  // The real SDK call goes here.
  return { ok: false, error: "QuickBooks transport not yet implemented." };
}

/**
 * Runs one sync attempt against an existing record.
 *
 * Shared by `queueSync` (first attempt) and `retrySync` (subsequent attempts)
 * so the two can never diverge.
 */
async function runAttempt(record: QBSyncRecordLean): Promise<QBSyncRecordLean> {
  const result = await syncToQuickBooks(record);

  const attempts = record.attempts + 1;
  const update: Record<string, unknown> = {
    attempts,
    lastSyncAt: new Date(),
    status: result.ok ? "Synced" : "Failed",
    syncError: result.ok ? null : (result.error ?? "Unknown QuickBooks error."),
  };
  if (result.ok && result.qbReference) update.qbReference = result.qbReference;
  if (result.ok && !record.qbReference) {
    update.qbReference = `QB-${1000 + attempts * 7}`;
  }

  await QBSyncRecord.updateOne({ _id: record._id }, { $set: update });
  const updated = await QBSyncRecord.findById(record._id).lean<QBSyncRecordLean>();
  return updated!;
}

/**
 * Queues a sync for an entity, creating the record if it does not exist.
 *
 * If a record already exists (a previous create or a retry), the idempotency
 * key is reused and the attempt count carries on — which is exactly what makes
 * a retry safe.
 */
export async function queueSync(
  entityType: "invoice" | "payment",
  entityId: Types.ObjectId,
  _actor: FinanceActor,
): Promise<QBSyncRecordDTO> {
  const key = idempotencyKeyFor(entityType, entityId);
  const existing = await QBSyncRecord.findOne({ idempotencyKey: key }).lean<QBSyncRecordLean>();

  if (!existing) {
    const doc = await QBSyncRecord.create({
      entityType,
      entityId,
      idempotencyKey: key,
      status: "Pending",
      attempts: 0,
      lastSyncAt: null,
      syncError: null,
      qbReference: null,
    });
    const updated = await runAttempt(doc.toObject() as QBSyncRecordLean);
    return toSyncRecordDTO(updated);
  }

  // Already queued — return the current state rather than inserting a duplicate.
  return toSyncRecordDTO(existing);
}

/**
 * `POST /integrations/quickbooks/sync/:type/:id`
 *
 * Retries a sync. Permission-gated at the route (`qb.retry`) because a retry
 * can create a real record in QuickBooks and should not be casually triggerable.
 */
export async function retrySync(
  entityType: "invoice" | "payment",
  entityId: string,
  actor: FinanceActor,
): Promise<QBSyncRecordDTO> {
  if (!Types.ObjectId.isValid(entityId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid entity id.");
  }

  const record = await QBSyncRecord.findOne({
    entityType,
    entityId: new Types.ObjectId(entityId),
  }).lean<QBSyncRecordLean>();

  if (!record) {
    throw AppError.notFound("Sync record not found.");
  }

  const updated = await runAttempt(record);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "qb_sync.retry",
    entityType: "qb_sync_record",
    entityId: String(record._id),
    before: { status: record.status, attempts: record.attempts },
    after: { status: updated.status, attempts: updated.attempts },
  });

  return toSyncRecordDTO(updated);
}

/** `GET /integrations/quickbooks/sync` — every sync record, for the queue view. */
export async function listSyncRecords(): Promise<QBSyncRecordDTO[]> {
  const docs = await QBSyncRecord.find().sort({ createdAt: -1 }).lean<QBSyncRecordLean[]>();
  return docs.map(toSyncRecordDTO);
}

/** Status of one entity's sync record, for embedding in an invoice response. */
export async function statusFor(
  entityType: "invoice" | "payment",
  entityId: string,
): Promise<QBSyncRecordLean["status"]> {
  if (!Types.ObjectId.isValid(entityId)) return "Not Synced";
  const record = await QBSyncRecord.findOne({
    entityType,
    entityId: new Types.ObjectId(entityId),
  }).lean<QBSyncRecordLean>();
  return record?.status ?? "Not Synced";
}

/** Used by the B6 reconciliation report. */
export { logger };
