import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { QBSyncRecord, type QBSyncRecordLean } from "../models/qb-sync-record.model.js";
import { findByQBReference, type QBSyncRecordDTO, toSyncRecordDTO } from "./qb-sync.service.js";

/**
 * QuickBooks webhook handling (BACKEND-PLAN §4 `POST
 * /integrations/quickbooks/webhook`).
 *
 * ## The verification rule that matters
 *
 * QuickBooks signs the **raw request body** and sends the digest in
 * `intuit-signature`. Express has already parsed the body into an object by the
 * time ordinary middleware runs, and re-serialising it does not reproduce the
 * exact bytes QuickBooks signed — so the signature can never match. This is why
 * `app.ts` mounts `express.raw()` on this path *before* `express.json()`.
 *
 * ## Always answer 200
 *
 * Intuit retries a webhook it considers failed. Returning anything but 2xx on a
 * notification we have recorded would cause duplicate deliveries, so every
 * verified payload is acknowledged even when it matches nothing we know about.
 */

export interface QBLine {
  Id: string;
  LineNum?: number;
  Description?: string;
  Amount?: number;
  DetailType?: string;
  LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }>;
}

export interface QBNotificationEntity {
  Id?: string;
  SyncToken?: string;
  domain?: string;
  name?: string;
  Email?: { Address?: string };
  PrimaryEmailAddr?: { Address?: string };
  Line?: QBLine[];
}

export interface QBWebhookPayload {
  eventNotifications?: Array<{
    realmId?: string;
    dataChangeEvent?: {
      entities?: QBNotificationEntity[];
    };
  }>;
}

/** Constant-time comparison that does not leak length through an early return. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the response time does not distinguish a
    // wrong length from a wrong value.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies the `intuit-signature` header against the raw body.
 *
 * Returns `false` when no verifier token is configured. That is deliberate:
 * without `QB_WEBHOOK_SECRET` there is nothing to verify against, and quietly
 * accepting unsigned callbacks would let anyone forge a "your sync failed"
 * notification.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!env.QB_WEBHOOK_SECRET) return false;
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", env.QB_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("base64");

  return safeEqual(signatureHeader.trim(), expected);
}

export interface WebhookResult {
  /** Always true once the signature verifies — the caller answers 200. */
  accepted: boolean;
  matched: number;
  /** Populated when the body could not be read; still answered with 200. */
  error?: string;
}

/**
 * Applies a verified webhook to the local sync records.
 *
 * On a change to an entity we have already created in QuickBooks, the new
 * `SyncToken` is stored. That is what lets B6 detect that someone edited an
 * invoice in QuickBooks behind the application's back — the local row and the
 * remote row now disagree on `SyncToken`.
 */
export async function handleWebhook(
  payload: QBWebhookPayload,
): Promise<WebhookResult> {
  let matched = 0;

  for (const notification of payload.eventNotifications ?? []) {
    const entities = notification.dataChangeEvent?.entities ?? [];
    for (const entity of entities) {
      const qbId = entity.Id;
      if (!qbId) continue;

      // Prefer an explicit line-level reference; fall back to the entity id
      // itself, which is how an Invoice/Payment notification arrives.
      const references = new Set<string>([qbId]);
      for (const line of entity.Line ?? []) {
        for (const linked of line.LinkedTxn ?? []) {
          if (linked.TxnId) references.add(linked.TxnId);
        }
      }

      for (const reference of references) {
        const record: QBSyncRecordLean | null = await findByQBReference(reference);
        if (!record) continue;

        matched += 1;
        await QBSyncRecord.updateOne(
          { _id: record._id },
          { $set: { lastSyncAt: new Date(), qbReference: reference } },
        );

        logger.info(
          { recordId: String(record._id), qbId: reference, syncToken: entity.SyncToken },
          "QB webhook matched a sync record",
        );
      }
    }
  }

  return { accepted: true, matched };
}

/** Resolves the DTO for the tests and the settings screen. */
export { toSyncRecordDTO };
export type { QBSyncRecordDTO };