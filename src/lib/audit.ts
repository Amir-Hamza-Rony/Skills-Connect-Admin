/**
 * Append-only audit write helper.
 *
 * Used by every mutating API route so that create/update/delete and financial
 * actions are traceable. Audit failures are intentionally swallowed: they must
 * never cause the primary operation to fail, but they are logged to stderr so
 * they are visible in production logs.
 *
 * Never pass passwords, password hashes, tokens or other credentials in
 * `before`/`after` — callers must strip secrets. `sanitizeAudit` strips a set
 * of known-sensitive keys as defense in depth.
 */

import { collection } from "@/lib/db";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "tokens",
  "refreshToken",
  "accessToken",
  "secret",
  "jwt",
  "session",
]);

function sanitizeAudit(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeAudit);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = sanitizeAudit(val);
      }
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  actorId: string | null;
  actorEmail: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const coll = await collection("audit_logs");
    await coll.insertOne({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      before: sanitizeAudit(input.before),
      after: sanitizeAudit(input.after),
      createdAt: new Date(),
    });
  } catch (err) {
    // Audit must never break the primary operation.
    console.error("[audit] failed to write audit record:", err);
  }
}

export interface DocumentAccessLogInput {
  documentId: string;
  actorId: string | null;
  action: string;
  ip: string | null;
  requestId: string | null;
}

export async function writeDocumentAccessLog(input: DocumentAccessLogInput): Promise<void> {
  try {
    const coll = await collection("document_access_logs");
    await coll.insertOne({
      documentId: input.documentId,
      actorId: input.actorId ?? null,
      action: input.action,
      ip: input.ip ?? null,
      requestId: input.requestId ?? null,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[audit] failed to write document access log:", err);
  }
}
