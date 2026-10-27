import { Router } from "express";

import {
  auditActions,
  auditEntityTypes,
  auditTotals,
  queryAuditLog,
  type AuditQuery,
} from "../services/audit-query.service.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";

/**
 * Audit trail viewer (BACKEND-PLAN §4, B6).
 *
 * Gated on `audit.view` rather than `users.manage`: reading the audit log is a
 * compliance activity, not user administration. Finance and Operations need to
 * see what happened without being able to create accounts.
 */
export const auditRouter: Router = Router();

auditRouter.use(requireAuth, requirePermission("audit.view"));

/** `GET /audit` — paged, filterable audit events. */
auditRouter.get("/", async (req, res) => {
  const q = req.query;
  const query: AuditQuery = {
    entityType: typeof q.entityType === "string" ? q.entityType : undefined,
    action: typeof q.action === "string" ? q.action : undefined,
    actorId: typeof q.actorId === "string" ? q.actorId : undefined,
    search: typeof q.search === "string" ? q.search : undefined,
    from: typeof q.from === "string" ? q.from : undefined,
    to: typeof q.to === "string" ? q.to : undefined,
    page: q.page !== undefined ? Number(q.page) : undefined,
    pageSize: q.pageSize !== undefined ? Number(q.pageSize) : undefined,
  };

  res.json(await queryAuditLog(query));
});

/**
 * `GET /audit/filters` — the vocabulary for the filter dropdowns.
 *
 * Served separately so the viewer can populate its selects before it loads any
 * events, and so adding an action name requires no frontend change.
 */
auditRouter.get("/filters", async (_req, res) => {
  const [entityTypes, actions, totals] = await Promise.all([
    auditEntityTypes(),
    auditActions(),
    auditTotals(),
  ]);
  res.json({ entityTypes, actions, totals });
});