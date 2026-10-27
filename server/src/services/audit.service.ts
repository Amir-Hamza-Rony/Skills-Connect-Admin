import type { Request } from "express";
import { Types } from "mongoose";

import { recordAuditLog } from "../models/audit-log.model.js";
import { logger } from "../lib/logger.js";

/**
 * Audit trail writer (architecture.md §1.4).
 *
 * Auditing must never be the reason a request fails, so a write error is logged
 * loudly and swallowed. The alternative — failing the mutation because the audit
 * insert failed — would be worse: it turns a logging outage into an outage.
 * Finance-grade builds usually invert this; here the append-only DB rows and
 * the failed-write log line are the accepted trade-off, and it is recorded.
 */

export interface AuditContext {
  actorId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry extends AuditContext {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Captures request metadata once so every service call inherits it. */
export function auditContextFrom(req: Request): AuditContext {
  return {
    actorId: req.auth?.userId ?? null,
    actorEmail: req.auth?.email ?? null,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    requestId: typeof req.id === "string" ? req.id : null,
  };
}

/** Strips secrets that must never land in an audit row. */
function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (/password|secret|token|hash/i.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = scrub(val);
  }
  return out;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await recordAuditLog({
      // The schema stores a real ObjectId reference; guard so a malformed id
      // cannot abort the audit write itself.
      actorId:
        entry.actorId && Types.ObjectId.isValid(entry.actorId)
          ? new Types.ObjectId(entry.actorId)
          : null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: scrub(entry.before) ?? null,
      after: scrub(entry.after) ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: entry.requestId ?? null,
    });
  } catch (err) {
    logger.error({ err, action: entry.action, entityType: entry.entityType }, "Audit write failed");
  }
}
