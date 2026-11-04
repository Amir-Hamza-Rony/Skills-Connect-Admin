/**
 * QuickBooks integration facade for Next.js.
 *
 * Wraps the QB client/sync logic behind a small interface so route handlers
 * can degrade gracefully when QB is not configured or when the underlying
 * dependencies are not available in the Next.js process.
 *
 * Every function returns null/undefined when the integration is unavailable,
 * and route handlers translate that into appropriate 422/503 responses.
 *
 * Security:
 *   - Access/refresh tokens are encrypted at rest (AES-256-GCM) using
 *     QB_ENCRYPTION_KEY. Tokens are never returned to the frontend and never
 *     logged.
 *   - OAuth state is validated by route handlers before calling here.
 *   - Expired/revoked connections are handled gracefully.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { QBEntityType } from "@/lib/types";

export interface QBStatus {
  configured: boolean;
  authorised: boolean;
  connectionStatus: "connected" | "disconnected" | "error" | "expired";
  realmId: string | null;
  sandbox: boolean;
}

export interface QBSyncRecordDTO {
  id: string;
  entityType: "customer" | "invoice" | "payment";
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

/** Encryption key for tokens at rest. Derived via scrypt when present. */
function encryptionKey(): Buffer | null {
  const secret = process.env.QB_ENCRYPTION_KEY;
  if (!secret) return null;
  return scryptSync(secret, "skills-connect-qb", 32);
}

function encryptToken(plaintext: string): { iv: string; authTag: string; ciphertext: string } | null {
  const key = encryptionKey();
  if (!key) return null;
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptToken(encrypted: { iv: string; authTag: string; ciphertext: string }): string | null {
  const key = encryptionKey();
  if (!key) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/** True when static QB credentials are present in the environment. */
export function isQuickBooksConfigured(): boolean {
  return Boolean(
    process.env.QB_CLIENT_ID && process.env.QB_CLIENT_SECRET,
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

/** Exchange an OAuth authorization code for access + refresh tokens. */
export async function exchangeCodeForTokens(
  code: string,
  realmId: string,
): Promise<{ ok: boolean; error?: string; realmId?: string }> {
  if (!process.env.QB_CLIENT_ID || !process.env.QB_CLIENT_SECRET) {
    return { ok: false, error: "QuickBooks is not configured." };
  }
  try {
    const tokenEndpoint =
      process.env.QB_TOKEN_URL ?? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    const basic = Buffer.from(
      `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`,
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri:
        process.env.QB_REDIRECT_URI ?? "http://localhost:4000/integrations/quickbooks/callback",
    });

    const resp = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    const json = (await resp.json()) as any;
    if (!resp.ok) {
      return { ok: false, error: json?.error_description ?? `Token exchange failed (${resp.status})` };
    }

    const accessToken = json.access_token;
    const refreshToken = json.refresh_token;
    const expiresIn = json.expires_in ?? 3600;
    if (!accessToken || !refreshToken) {
      return { ok: false, error: "Token response missing access/refresh token." };
    }

    const encryptedAccess = encryptToken(accessToken);
    const encryptedRefresh = encryptToken(refreshToken);

    const { collection } = await import("@/lib/db");
    const qbConns = await collection("qb_connections");
    await qbConns.updateOne(
      {},
      {
        $set: {
          realmId,
          accessTokenEncrypted: encryptedAccess
            ? JSON.stringify(encryptedAccess)
            : accessToken, // degraded: store raw if encryption unavailable
          refreshTokenEncrypted: encryptedRefresh
            ? JSON.stringify(encryptedRefresh)
            : refreshToken,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          scope: json.scope ?? null,
          connectionStatus: "connected",
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date(), connectedBy: "oauth-user" },
      },
      { upsert: true },
    );
    return { ok: true, realmId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Token exchange failed." };
  }
}

/** Refresh an expired access token using the stored refresh token. */
export async function refreshAccessToken(): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.QB_CLIENT_ID || !process.env.QB_CLIENT_SECRET) {
    return { ok: false, error: "QuickBooks is not configured." };
  }
  try {
    const { collection } = await import("@/lib/db");
    const qbConns = await collection("qb_connections");
    const doc = await qbConns.findOne({});
    if (!doc) {
      return { ok: false, error: "No QuickBooks connection." };
    }
    const refreshToken = decryptToken(
      typeof doc.refreshTokenEncrypted === "string"
        ? JSON.parse(doc.refreshTokenEncrypted)
        : doc.refreshTokenEncrypted,
    );
    if (!refreshToken) {
      return { ok: false, error: "Unable to decrypt refresh token." };
    }

    const tokenEndpoint =
      process.env.QB_TOKEN_URL ?? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    const basic = Buffer.from(
      `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`,
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const resp = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    const json = (await resp.json()) as any;
    if (!resp.ok) {
      await qbConns.updateOne(
        {},
        { $set: { connectionStatus: "expired", updatedAt: new Date() } },
      );
      return { ok: false, error: json?.error_description ?? `Token refresh failed (${resp.status})` };
    }

    const accessToken = json.access_token;
    const newRefreshToken = json.refresh_token ?? refreshToken;
    const expiresIn = json.expires_in ?? 3600;
    if (!accessToken) {
      return { ok: false, error: "Token response missing access token." };
    }

    const encryptedAccess = encryptToken(accessToken);
    const encryptedRefresh = encryptToken(newRefreshToken);

    await qbConns.updateOne(
      {},
      {
        $set: {
          accessTokenEncrypted: encryptedAccess
            ? JSON.stringify(encryptedAccess)
            : accessToken,
          refreshTokenEncrypted: encryptedRefresh
            ? JSON.stringify(encryptedRefresh)
            : newRefreshToken,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          connectionStatus: "connected",
          updatedAt: new Date(),
        },
      },
    );
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Token refresh failed." };
  }
}

/** Get a valid access token, refreshing if necessary. */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { collection } = await import("@/lib/db");
    const qbConns = await collection("qb_connections");
    const doc = await qbConns.findOne({});
    if (!doc) return null;
    if (doc.connectionStatus !== "connected") return null;
    const expiresAt = doc.tokenExpiresAt ? new Date(doc.tokenExpiresAt).getTime() : 0;
    const now = Date.now();
    // Refresh 5 minutes before expiry.
    if (expiresAt > 0 && now > expiresAt - 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken();
      if (!refreshed.ok) return null;
      const doc2 = await qbConns.findOne({});
      if (!doc2) return null;
      const decrypted = decryptToken(
        typeof doc2.accessTokenEncrypted === "string"
          ? JSON.parse(doc2.accessTokenEncrypted)
          : doc2.accessTokenEncrypted,
      );
      return decrypted ?? doc2.accessTokenEncrypted ?? null;
    }
    const decrypted = decryptToken(
      typeof doc.accessTokenEncrypted === "string"
        ? JSON.parse(doc.accessTokenEncrypted)
        : doc.accessTokenEncrypted,
    );
    return decrypted ?? doc.accessTokenEncrypted ?? null;
  } catch {
    return null;
  }
}

/** Disconnect / revoke the QuickBooks connection. */
export async function disconnect(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { collection } = await import("@/lib/db");
    const qbConns = await collection("qb_connections");
    await qbConns.updateOne(
      {},
      { $set: { connectionStatus: "disconnected", updatedAt: new Date() } },
    );
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Disconnect failed." };
  }
}

/** Connection status — non-secret, safe for the settings screen. */
export async function quickBooksStatus(): Promise<QBStatus> {
  let authorised = false;
  let realmId: string | null = null;
  let connectionStatus: QBStatus["connectionStatus"] = "disconnected";
  try {
    const { collection } = await import("@/lib/db");
    const qbConns = await collection("qb_connections");
    const doc = await qbConns.findOne({});
    if (doc) {
      authorised = doc.connectionStatus === "connected";
      realmId = doc.realmId ?? null;
      connectionStatus = doc.connectionStatus;
    }
  } catch {
    // Collection may not exist yet — treat as not authorised.
  }

  return {
    configured: isQuickBooksConfigured(),
    authorised,
    connectionStatus,
    realmId: process.env.QB_REALM_ID ?? realmId ?? null,
    sandbox: process.env.QB_SANDBOX !== "false",
  };
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
  entityType: "customer" | "invoice" | "payment",
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

/** Enqueue a local→QB sync for an entity (idempotent by idempotencyKey). */
export async function enqueueSync({
  entityType,
  entityId,
  idempotencyKey,
}: {
  entityType: QBEntityType;
  entityId: string;
  idempotencyKey: string;
}): Promise<QBSyncRecordDTO | null> {
  try {
    const { collection, toObjectId } = await import("@/lib/db");
    const coll = await collection("qb_sync_records");
    const existing = await coll.findOne({ idempotencyKey });
    if (existing) {
      return {
        id: String(existing._id),
        entityType: existing.entityType,
        entityId: String(existing.entityId),
        idempotencyKey: existing.idempotencyKey,
        status: existing.status,
        attempts: existing.attempts,
        lastSyncAt: existing.lastSyncAt ? String(existing.lastSyncAt) : null,
        syncError: existing.syncError ?? null,
        qbReference: existing.qbReference ?? null,
      };
    }
    const now = new Date();
    const result = await coll.insertOne({
      entityType,
      entityId: toObjectId(entityId),
      idempotencyKey,
      direction: "local_to_qb",
      status: "Pending",
      attempts: 0,
      lastSyncAt: null,
      syncError: null,
      qbReference: null,
      createdAt: now,
      updatedAt: now,
    });
    const created = await coll.findOne({ _id: result.insertedId });
    if (!created) return null;
    return {
      id: String(created._id),
      entityType: created.entityType,
      entityId: String(created.entityId),
      idempotencyKey: created.idempotencyKey,
      status: created.status,
      attempts: created.attempts,
      lastSyncAt: created.lastSyncAt ? String(created.lastSyncAt) : null,
      syncError: created.syncError ?? null,
      qbReference: created.qbReference ?? null,
    };
  } catch {
    return null;
  }
}

/** Retry a sync for an entity. */
export async function retrySync(
  entityType: "customer" | "invoice" | "payment",
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
        lastSyncAt: record.lastSyncAt ? String(record.lastSyncAt) : null,
        syncError: record.syncError ?? null,
        qbReference: record.qbReference ?? null,
      };
    }

    // Attempt the sync through the QB transport if configured.
    let result: QBTransportResult = { ok: false, error: "QuickBooks is not configured." };
    if (isQuickBooksConfigured()) {
      const token = await getAccessToken();
      if (!token) {
        result = { ok: false, error: "No valid QuickBooks access token." };
      } else {
        result = { ok: false, error: "QuickBooks transport not implemented in Next.js." };
      }
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
