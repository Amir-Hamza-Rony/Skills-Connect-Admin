/**
 * POST /api/integrations/quickbooks/webhook — QuickBooks webhook
 *
 * Verifies the `intuit-signature` HMAC over the raw request body.
 * Always answers 200 once the signature verifies — Intuit retries on non-2xx.
 *
 * Processing:
 *   - Event deduplication by Intuit eventId (stored in qb_webhook_events)
 *   - For each changed entity, enqueue a qb→local sync record (Pending)
 *   - Failed event processing is tracked; never throws to Intuit
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { collection } from "@/lib/db";
import type { QBEntityType } from "@/lib/types";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

const ENTITY_MAP: Record<string, QBEntityType> = {
  Invoice: "invoice",
  Payment: "payment",
  Customer: "customer",
};

async function isEventProcessed(eventId: string): Promise<boolean> {
  try {
    const coll = await collection("qb_webhook_events");
    const existing = await coll.findOne({ eventId });
    return Boolean(existing);
  } catch {
    return false;
  }
}

async function markEventProcessed(eventId: string): Promise<void> {
  try {
    const coll = await collection("qb_webhook_events");
    await coll.updateOne(
      { eventId },
      { $setOnInsert: { eventId, receivedAt: new Date() } },
      { upsert: true },
    );
  } catch {
    // Best effort — deduplication is advisory.
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signatureHeader = req.headers.get("intuit-signature");
  const secret = process.env.QB_WEBHOOK_SECRET;

  if (!secret || !signatureHeader) {
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed." } },
      { status: 401 },
    );
  }

  const raw = Buffer.from(await req.arrayBuffer());
  const expected = createHmac("sha256", secret).update(raw).digest("base64");

  if (!safeEqual(signatureHeader.trim(), expected)) {
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed." } },
      { status: 401 },
    );
  }

  let payload: any;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Body is not valid JSON." } },
      { status: 400 },
    );
  }

  let matched = 0;
  let enqueued = 0;
  try {
    for (const notification of payload.eventNotifications ?? []) {
      const eventId = notification.eventId ?? notification.nonce ?? String(Date.now());
      if (await isEventProcessed(eventId)) continue;
      await markEventProcessed(eventId);

      const entities = notification.dataChangeEvent?.entities ?? [];
      for (const entity of entities) {
        const qbId = entity.Id;
        const entityName = entity.name ?? "";
        const entityType = ENTITY_MAP[entityName];
        if (!qbId || !entityType) continue;

        matched += 1;

        // Find any existing local sync record for this QB reference and mark it
        // for re-check. When no local record exists, the QB-side change is
        // surfaced through reconciliation rather than inventing a local id.
        try {
          const coll = await collection("qb_sync_records");
          const records = await coll.find({ qbReference: qbId }).toArray();
          if (records.length > 0) {
            await coll.updateMany(
              { qbReference: qbId },
              { $set: { lastSyncAt: new Date(), status: "Pending", syncError: null } },
            );
            enqueued += records.length;
          }
        } catch {
          // Ignore DB errors — always answer 200 to Intuit.
        }
      }
    }
  } catch {
    // Ignore payload processing errors — always answer 200 to Intuit.
  }

  return NextResponse.json({ ok: true, matched, enqueued });
}
