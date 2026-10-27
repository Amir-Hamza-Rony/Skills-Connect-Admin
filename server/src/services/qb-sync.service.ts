import { Types } from "mongoose";

import {
  hasTransportOverride,
  isQuickBooksConfigured,
  quickBooksTransport,
} from "../integrations/quickbooks/client.js";
import { buildPayloadFor } from "../integrations/quickbooks/payloads.js";
import { enqueueQBSync } from "../jobs/qb-sync.queue.js";
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
 * duplicate QB record. The same key doubles as the BullMQ `jobId`, so the queue
 * deduplicates a redelivered job as well.
 *
 * ## Transport
 *
 * The QuickBooks API call lives in `integrations/quickbooks/`. Without sandbox
 * credentials — or without an OAuth-authorised company — that transport cannot
 * succeed, so an attempt reports `Failed` with a specific, actionable reason
 * rather than pretending. The status flow (Not Synced → Pending → Synced,
 * Failed retryable) and the idempotency guarantee are real and testable
 * independently of whether QuickBooks is reachable.
 *
 * ## Queueing
 *
 * B5 specifies a BullMQ worker so attempts are queued rather than inline. Redis
 * is not available in every environment (it needs Docker, which is not
 * installed on the dev machine), so `queueSync` hands the job to the worker when
 * Redis is up and runs the identical handler inline when it is not.
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
 * Kept behind this interface so the queue, the retry endpoint and the worker
 * all share one definition of "did the sync work", and so a test can drive both
 * outcomes without touching the network.
 */
export interface QBTransportResult {
  ok: boolean;
  qbReference?: string;
  error?: string;
}

/**
 * The real QuickBooks call.
 *
 * Three distinct refusals, each named so an operator knows what to do:
 * no static credentials configured · company not OAuth-authorised · the client
 * is not mapped to a QuickBooks customer. Anything else is whatever QuickBooks
 * said, flattened to one line by the client.
 */
export async function syncToQuickBooks(
  record: QBSyncRecordLean,
): Promise<QBTransportResult> {
  // A test transport stands in for the whole integration, credentials included —
  // otherwise the "retry creates exactly one QB record" criterion is untestable
  // in CI, which is precisely the criterion most worth testing.
  if (!hasTransportOverride() && !isQuickBooksConfigured()) {
    return {
      ok: false,
      error: "QuickBooks is not configured (QB_REALM_ID / QB_CLIENT_ID not set).",
    };
  }

  const built = await buildPayloadFor(record.entityType, String(record.entityId));
  if (!built.ok || !built.payload) {
    return { ok: false, error: built.error ?? "Could not build the QuickBooks payload." };
  }

  const api = quickBooksTransport();
  const result =
    record.entityType === "invoice"
      ? await api.createInvoice(built.payload)
      : await api.createPayment(built.payload);

  if (!result.ok) {
    return { ok: false, error: result.error ?? "QuickBooks rejected the request." };
  }

  const ref = result.data?.Invoice?.Id ?? result.data?.Payment?.Id;
  if (!ref) {
    // A 2xx with no entity id means the shape was not what we expected; treat
    // it as a failure rather than recording a sync with nothing to point at.
    return { ok: false, error: "QuickBooks accepted the request but returned no record id." };
  }

  return { ok: true, qbReference: ref };
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
  // Only ever the id QuickBooks itself issued. An earlier version invented a
  // reference when the transport reported success without one, which produced
  // `qbReference` values that matched nothing in QuickBooks and made the B6
  // reconciliation silently drop every row it joined on.
  if (result.ok && result.qbReference) update.qbReference = result.qbReference;

  await QBSyncRecord.updateOne({ _id: record._id }, { $set: update });
  const updated = await QBSyncRecord.findById(record._id).lean<QBSyncRecordLean>();
  return updated!;
}

/**
 * Loads a record by id and runs one attempt. The worker entry point.
 *
 * Resolves even when the sync failed — the failure is already persisted on the
 * record, and returning a result lets the worker log it without turning a
 * QuickBooks rejection into an infrastructure error.
 */
export async function processSyncRecord(
  recordId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!Types.ObjectId.isValid(recordId)) {
    return { ok: false, error: "Invalid sync record id." };
  }
  const record = await QBSyncRecord.findById(recordId).lean<QBSyncRecordLean | null>();
  if (!record) return { ok: false, error: "Sync record not found." };

  // Already synced: doing nothing is the correct outcome of a redelivered job,
  // and it is the guarantee that makes the queue safe to retry.
  if (record.status === "Synced") {
    logger.info({ recordId }, "QB sync already complete — skipping");
    return { ok: true };
  }

  const updated = await runAttempt(record);
  return updated.status === "Synced"
    ? { ok: true }
    : { ok: false, error: updated.syncError ?? "QuickBooks sync failed." };
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

  if (existing) {
    // Already queued — return the current state rather than inserting a duplicate.
    return toSyncRecordDTO(existing);
  }

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
  const recordId = String(doc._id);

  // Hand the attempt to BullMQ. With Redis up the record stays `Pending` until
  // the worker picks it up; with Redis down the same handler runs inline and the
  // record is already resolved by the time this returns.
  const { queued } = await enqueueQBSync({ recordId, entityType, entityId: String(entityId), idempotencyKey: key }, () =>
    processSyncRecord(recordId),
  );

  if (queued) return toSyncRecordDTO(doc.toObject() as QBSyncRecordLean);

  const updated = await QBSyncRecord.findById(recordId).lean<QBSyncRecordLean>();
  return toSyncRecordDTO(updated!);
}

/**
 * `POST /integrations/quickbooks/sync/:type/:id`
 *
 * Retries a sync. Permission-gated at the route (`qb.retry`) because a retry
 * can create a real record in QuickBooks and should not be casually triggerable.
 *
 * Runs inline rather than through the queue, unlike the automatic path: this is
 * a deliberate human action and the caller needs the resulting status in the
 * response to refresh the screen. The attempt logic is the same `runAttempt`,
 * so a retry can never behave differently from a queued one.
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

  // A retry of an already-synced record is a no-op, NOT another attempt.
  //
  // This guard is what makes "retry creates exactly one QuickBooks record" true.
  // It used to call `runAttempt` unconditionally, so pressing retry on a
  // successful sync issued a second create to QuickBooks — two invoices in the
  // accounting system, one local record, pointing at only the first. The old
  // test could not catch it: it asserted the local record stayed singular,
  // which it did, while QuickBooks quietly collected duplicates.
  if (record.status === "Synced") {
    return toSyncRecordDTO(record);
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

/** `GET /integrations/quickbooks/sync/:type/:id` — one entity's sync state. */
export async function syncRecordFor(
  entityType: "invoice" | "payment",
  entityId: string,
): Promise<QBSyncRecordDTO | null> {
  if (!Types.ObjectId.isValid(entityId)) return null;
  const record = await QBSyncRecord.findOne({
    entityType,
    entityId: new Types.ObjectId(entityId),
  }).lean<QBSyncRecordLean>();
  return record ? toSyncRecordDTO(record) : null;
}

/** Status of one entity's sync record, for embedding in an invoice response. */
export async function statusFor(
  entityType: "invoice" | "payment",
  entityId: string,
): Promise<QBSyncRecordLean["status"]> {
  const record = await QBSyncRecord.findOne({
    entityType,
    entityId: Types.ObjectId.isValid(entityId) ? new Types.ObjectId(entityId) : null,
  }).lean<QBSyncRecordLean>();
  return record?.status ?? "Not Synced";
}

/**
 * Finds the sync record for a QuickBooks entity id, or `null`.
 *
 * Used by the webhook handler: QuickBooks tells us about a change to record
 * `Id`, and that has to be joined back to our own record id before anything can
 * be updated.
 */
export async function findByQBReference(qbReference: string): Promise<QBSyncRecordLean | null> {
  return QBSyncRecord.findOne({ qbReference }).lean<QBSyncRecordLean>();
}
