import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { AuditLog, type AuditLogLean } from "../models/audit-log.model.js";
import { escapeRegex } from "./masters.service.js";

/**
 * Audit trail queries (BACKEND-PLAN §4, B6).
 *
 * ## Read-only by construction
 *
 * This module only ever reads. The collection itself is append-only — every
 * update and delete verb throws a pre-hook error — so there is no write path to
 * get wrong here.
 *
 * ## Searching `before` / `after`
 *
 * Those fields are `Mixed`: they hold whatever shape the mutation carried, from
 * a status string to a nested object. A plain `$regex` cannot match them, so the
 * search converts each to a string first with `$toString`. Without that, a
 * search for an old status value would find nothing and look like the event was
 * never recorded.
 *
 * ## Pagination is required, not optional
 *
 * The audit log grows on every mutation in the system. Returning it whole is
 * how a viewer ends up transferring ten thousand rows to answer "what changed
 * on order X", so every call is paginated and the total is returned alongside.
 */

export interface AuditQuery {
  entityType?: string;
  /** Exact match on the action name, e.g. `order.status.change`. */
  action?: string;
  actorId?: string;
  /** Free text across action, entity id, actor email, before and after. */
  search?: string;
  /** `YYYY-MM-DD`, inclusive, on `createdAt`. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditEventDTO {
  id: string;
  timestamp: string;
  actorId: string | null;
  actorEmail: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
}

export interface AuditPage {
  events: AuditEventDTO[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

const MAX_PAGE_SIZE = 200;

function toDTO(doc: AuditLogLean): AuditEventDTO {
  return {
    id: String(doc._id),
    timestamp: doc.createdAt.toISOString(),
    actorId: doc.actorId ? String(doc.actorId) : null,
    actorEmail: doc.actorEmail ?? null,
    entityType: doc.entityType,
    entityId: doc.entityId ?? null,
    action: doc.action,
    before: doc.before ?? null,
    after: doc.after ?? null,
    ip: doc.ip ?? null,
    requestId: doc.requestId ?? null,
  };
}

function dateBound(value: string, endOfDay: boolean): Date {
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(d.getTime())) {
    throw AppError.badRequest("INVALID_DATE", `"${value}" is not a YYYY-MM-DD date.`);
  }
  return d;
}

/**
 * Runs a paged audit query.
 *
 * `distinctEntityTypes()` is what populates the filter dropdown, and it is its
 * own call so the viewer does not have to know the vocabulary up front.
 */
export async function queryAuditLog(query: AuditQuery): Promise<AuditPage> {
  const match: Record<string, unknown> = {};

  if (query.entityType && query.entityType.trim()) {
    match.entityType = query.entityType.trim();
  }
  if (query.action && query.action.trim()) {
    match.action = query.action.trim();
  }
  if (query.actorId) {
    if (!Types.ObjectId.isValid(query.actorId)) {
      throw AppError.badRequest("INVALID_ID", "Invalid actor id.");
    }
    match.actorId = new Types.ObjectId(query.actorId);
  }

  const range: Record<string, Date> = {};
  if (query.from) range.$gte = dateBound(query.from, false);
  if (query.to) range.$lte = dateBound(query.to, true);
  if (Object.keys(range).length > 0) match.createdAt = range;

  if (query.search && query.search.trim()) {
    const safe = escapeRegex(query.search.trim()).slice(0, 100);
    match.$or = [
      { action: { $regex: safe, $options: "i" } },
      { entityId: { $regex: safe, $options: "i" } },
      { actorEmail: { $regex: safe, $options: "i" } },
      // `before`/`after` are Mixed — a string, an object, or null depending on
      // what the mutation carried. `$toString` alone 500s on both objects and
      // nulls, which would break the whole query. `$convert` with `onError`
      // returns an empty string for anything that cannot be stringified, so a
      // search simply does not match those rows.
      {
        $expr: {
          $regexMatch: {
            input: { $convert: { input: { $ifNull: ["$before", ""] }, to: "string", onError: "" } },
            regex: safe,
            options: "i",
          },
        },
      },
      {
        $expr: {
          $regexMatch: {
            input: { $convert: { input: { $ifNull: ["$after", ""] }, to: "string", onError: "" } },
            regex: safe,
            options: "i",
          },
        },
      },
    ];
  }

  // Bounded no matter what the caller asks for. A 10,000-row page is a
  // denial-of-service on the viewer, not a feature.
  const pageSize = Math.min(Math.max(1, query.pageSize ?? 50), MAX_PAGE_SIZE);
  const page = Math.max(1, query.page ?? 1);

  const [docs, total] = await Promise.all([
    AuditLog.find(match).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean<AuditLogLean[]>(),
    AuditLog.countDocuments(match),
  ]);

  return {
    events: docs.map(toDTO),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Every distinct `entityType`, for the filter dropdown. */
export async function auditEntityTypes(): Promise<string[]> {
  const types = await AuditLog.distinct("entityType").lean<string[]>();
  return types.sort();
}

/** Every distinct action, for the filter dropdown. */
export async function auditActions(): Promise<string[]> {
  const actions = await AuditLog.distinct("action").lean<string[]>();
  return actions.sort();
}

/** Totals for the viewer header, so "0 events" is distinguishable from "no query". */
export async function auditTotals(): Promise<{ events: number; actors: number }> {
  const [events, actors] = await Promise.all([
    AuditLog.countDocuments(),
    AuditLog.distinct("actorId").lean(),
  ]);
  return { events, actors: actors.filter(Boolean).length };
}