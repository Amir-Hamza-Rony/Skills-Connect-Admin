/**
 * POST /api/integrations/quickbooks/webhook — QuickBooks webhook
 * Mirrors Express `POST /integrations/quickbooks/webhook`.
 *
 * Verifies the `intuit-signature` HMAC over the raw request body.
 * Always answers 200 once the signature verifies — Intuit retries on non-2xx.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
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
  try {
    for (const notification of payload.eventNotifications ?? []) {
      const entities = notification.dataChangeEvent?.entities ?? [];
      for (const entity of entities) {
        const qbId = entity.Id;
        if (!qbId) continue;
        const references = new Set<string>([qbId]);
        for (const line of entity.Line ?? []) {
          for (const linked of line.LinkedTxn ?? []) {
            if (linked.TxnId) references.add(linked.TxnId);
          }
        }
        for (const reference of references) {
          try {
            const { collection } = await import("@/lib/db");
            const coll = await collection("qb_sync_records");
            const records = await coll.find({ qbReference: reference }).toArray();
            if (records.length > 0) {
              matched += 1;
              await coll.updateMany(
                { qbReference: reference },
                { $set: { lastSyncAt: new Date(), qbReference: reference } },
              );
            }
          } catch {
            // Ignore DB errors — always answer 200 to Intuit.
          }
        }
      }
    }
  } catch {
    // Ignore payload processing errors — always answer 200 to Intuit.
  }

  return NextResponse.json({ ok: true, matched });
}
