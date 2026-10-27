import type { RequestHandler } from "express";

import { AppError } from "../lib/app-error.js";
import { recordAudit } from "../services/audit.service.js";
import type { Permission } from "../services/permissions.js";

/**
 * Server-side permission gate. Frontend route guards and hidden buttons are UX
 * only — this is the actual enforcement point (architecture.md §1.4).
 *
 * Always mount AFTER `requireAuth`, because the decision needs `req.auth`.
 *
 *   router.get("/users", requireAuth, requirePermission("users.manage"), handler)
 */
export function requirePermission(required: Permission): RequestHandler {
  return (req, res, next) => {
    const auth = req.auth;
    if (!auth) {
      next(AppError.unauthorized());
      return;
    }

    if (auth.permissions.includes(required)) {
      next();
      return;
    }

    // A denied access attempt is exactly the kind of event the audit trail
    // exists for, so it is recorded before the rejection is sent.
    //
    // The write is awaited deliberately. It used to be fire-and-forget, which
    // left a window where the 403 had already been returned but no row existed
    // — a probe could hit the API and read "nothing was logged". `recordAudit`
    // swallows its own errors, so awaiting cannot fail the request; it only
    // guarantees the row is durable before the caller learns it was denied.
    void recordAudit({
      action: "permission.denied",
      entityType: "route",
      entityId: `${req.method} ${req.originalUrl}`,
      after: { required },
      actorId: auth.userId,
      actorEmail: auth.email,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
      requestId: typeof req.id === "string" ? req.id : null,
    }).then(() =>
      next(
        AppError.forbidden(
          `Your role (${auth.roleNames.join(", ") || "none"}) does not include "${required}".`,
        ),
      ),
    );
  };
}

/** Requires ALL of the listed permissions (e.g. finance mutation + qb.retry). */
export function requireAllPermissions(...required: Permission[]): RequestHandler {
  const guards = required.map((p) => requirePermission(p));
  return (req, res, next) => {
    let i = 0;
    const run = (err?: unknown): void => {
      if (err) {
        next(err);
        return;
      }
      const guard = guards[i++];
      if (!guard) {
        next();
        return;
      }
      guard(req, res, run);
    };
    run();
  };
}