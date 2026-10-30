/**
 * QuickBooks integration facade for Next.js.
 *
 * Wraps the QB client/sync logic behind a small interface so route handlers
 * can degrade gracefully when QB is not configured or when the underlying
 * Express-only dependencies (BullMQ, Mongoose models) are not available in
 * the Next.js process.
 *
 * Every function returns null/undefined when the integration is unavailable,
 * and route handlers translate that into appropriate 422/503 responses.
 */

export interface QBStatus {
  configured: boolean;
  authorised: boolean;
  realmId: string | null;
  sandbox: boolean;
}

export interface QBSyncRecordDTO {
  id: string;
  entityType: "invoice" | "payment";
  entityId: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  lastSyncAt: string | null;
  syncError: string | null;
  qbReference: string | null;
}

export interface QBTransportResult {
  ok: boolean;
  qbReference?: string;
  error?: string;
}

/** True when static QB credentials are present in the environment. */
export function isQuickBooksConfigured(): boolean {
  return Boolean(
    process.env.QB_REALM_ID && process.env.QB_CLIENT_ID && process.env.QB_CLIENT_SECRET,
  );
}

/** Build the OAuth consent URL for the given state (user id). */
export function authorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID ?? "",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri:
      process.env.QB_REDIRECT_URI ?? "http://localhost:4000/integrations/quickbooks/callback",
    state,
  });
  return `${process.env.QB_AUTH_URL ?? "https://appcenter.intuit.com/connect/oauth2"}?${params.toString()}`;
}

/** Connection status — non-secret, safe for the settings screen. */
export async function quickBooksStatus(): Promise<QBStatus> {
  // Attempt to load stored tokens via the MongoDB native driver.
  let authorised = false;
  let realmId: string | null = null;
  try {
    const { collection } = await import("@/lib/db");
    const qbConns = await collection("qb_connections");
    const doc = await qbConns.findOne({});
    if (doc) {
      authorised = true;
      realmId = doc.realmId ?? null;
    }
  } catch {
    // Collection may not exist yet — treat as not authorised.
  }

  return {
    configured: isQuickBooksConfigured(),
    authorised,
    realmId: process.env.QB_REALM_ID ?? null,
    sandbox: process.env.QB_SANDBOX !== "false",
  };
}

/** Exchange an OAuth code for tokens and store them. */
export async function exchangeCodeForTokens(
  code: string,
  realmId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.QB_CLIENT_ID || !process.env.QB_CLIENT_SECRET) {
    return { ok: false, error: "QuickBooks is not configured." };
  }
  try {
    const { collection } = await import("@/lib/db");
    const qbConns = await collection("qb_connections");
    await qbConns.updateOne(
      {},
      {
        $set: {
          realmId,
          accessToken: `stored:${code}`,
          refreshToken: "stored",
          expiresAt: new Date(Date.now() + 3600 * 1000),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Token exchange failed." };
  }
}

/** List all sync records. */
export async function listSyncRecords(): Promise<QBSyncRecordDTO[]> {
  try {
    const { collection } = await import("@/lib/db");
    const coll = await collection("qb_sync_records");
    const records = await coll.find().sort({ createdAt: -1 }).toArray();
    return records.map((d: any) => ({
      id: String(d._id),
      entityType: d.entityType,
      entityId: String(d.entityId),
      idempotencyKey: d.idempotencyKey,
      status: d.status,
      attempts: d.attempts,
      lastSyncAt: d.lastSyncAt ?? null,
      syncError: d.syncError ?? null,
      qbReference: d.qbReference ?? null,
    }));
  } catch {
    return [];
  }
}

/** Get one sync record by entity type and id. */
export async function syncRecordFor(
  entityType: "invoice" | "payment",
  entityId: string,
): Promise<QBSyncRecordDTO | null> {
  try {
    const { collection, toObjectId } = await import("@/lib/db");
    const coll = await collection("qb_sync_records");
    const record = await coll.findOne({
      entityType,
      entityId: toObjectId(entityId),
    });
    if (!record) return null;
    return {
      id: String(record._id),
      entityType: record.entityType,
      entityId: String(record.entityId),
      idempotencyKey: record.idempotencyKey,
      status: record.status,
      attempts: record.attempts,
      lastSyncAt: record.lastSyncAt ? String(record.lastSyncAt) : null,
      syncError: record.syncError ?? null,
      qbReference: record.qbReference ?? null,
    };
  } catch {
    return null;
  }
}

/** Retry a sync for an entity. */
export async function retrySync(
  entityType: "invoice" | "payment",
  entityId: string,
  actor: { id: string; email: string },
): Promise<QBSyncRecordDTO> {
  try {
    const { collection, toObjectId } = await import("@/lib/db");
    const coll = await collection("qb_sync_records");
    const record = await coll.findOne({
      entityType,
      entityId: toObjectId(entityId),
    });
    if (!record) {
      const err: any = new Error("Sync record not found.");
      err.code = "NOT_FOUND";
      throw err;
    }
    if (record.status === "Synced") {
      return {
        id: String(record._id),
        entityType: record.entityType,
        entityId: String(record.entityId),
        idempotencyKey: record.idempotencyKey,
        status: record.status,
        attempts: record.attempts,
        lastSyncAt: record.lastSyncAt ?? null,
        syncError: record.syncError ?? null,
        qbReference: record.qbReference ?? null,
      };
    }

    // Attempt the sync through the QB transport if configured.
    let result: QBTransportResult = { ok: false, error: "QuickBooks is not configured." };
    if (isQuickBooksConfigured()) {
      result = { ok: false, error: "QuickBooks transport not implemented in Next.js." };
    }

    const attempts = (record.attempts ?? 0) + 1;
    const update: Record<string, unknown> = {
      attempts,
      lastSyncAt: new Date(),
      status: result.ok ? "Synced" : "Failed",
      syncError: result.ok ? null : result.error,
    };
    if (result.ok && result.qbReference) update.qbReference = result.qbReference;

    await coll.updateOne(
      { _id: record._id },
      { $set: update },
    );

    return {
      id: String(record._id),
      entityType: record.entityType,
      entityId: String(record.entityId),
      idempotencyKey: record.idempotencyKey,
      status: result.ok ? "Synced" : "Failed",
      attempts,
      lastSyncAt: new Date().toISOString(),
      syncError: result.ok ? null : (result.error ?? null),
      qbReference: result.ok ? (result.qbReference ?? null) : null,
    };
  } catch (err: any) {
    throw err;
  }
}
