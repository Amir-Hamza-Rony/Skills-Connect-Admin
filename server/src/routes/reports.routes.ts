import { Router } from "express";

import { AppError } from "../lib/app-error.js";
import { isOrderStatus } from "../types/workflow.js";

import {
  ageingReport,
  buildReportContext,
  collectionsReport,
  financeReport,
  funnelReport,
  marginReport,
  revenueReport,
  rtoTurnaroundReport,
  type ReportFilter,
} from "../services/reports.service.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";

/**
 * Reports (BACKEND-PLAN §4, B6).
 *
 * Every route accepts the same filter set, so a screen can show one cohort
 * across every report:
 *
 *   ?salesAgentId=&sourceAgentId=&rtoId=&qualificationId=&stage=&from=&to=
 *
 * `from`/`to` are `YYYY-MM-DD` and bound order creation.
 *
 * `reports.view` is the permission throughout: these are read-only views over
 * data the caller can already see elsewhere. They do not widen access, they
 * only aggregate it.
 */
export const reportsRouter: Router = Router();

reportsRouter.use(requireAuth, requirePermission("reports.view"));

/**
 * Parses the shared filter out of the query string.
 *
 * Unknown stages are rejected rather than ignored — a typo in a filter that
 * silently returns everything is worse than a 400.
 */
function parseFilter(query: Record<string, unknown>): ReportFilter {
  const filter: ReportFilter = {};
  for (const key of ["salesAgentId", "sourceAgentId", "rtoId", "qualificationId"] as const) {
    if (typeof query[key] === "string" && query[key]) filter[key] = query[key] as string;
  }
  if (typeof query.stage === "string" && query.stage) {
    // Rejected rather than ignored: a filter that silently returns everything
    // on a typo is worse than a 400.
    if (!isOrderStatus(query.stage)) {
      throw AppError.badRequest("INVALID_STAGE", `"${query.stage}" is not an order status.`);
    }
    filter.stage = query.stage;
  }
  for (const key of ["from", "to"] as const) {
    if (typeof query[key] === "string" && query[key]) filter[key] = query[key] as string;
  }
  return filter;
}

/** `GET /reports/finance` — headline numbers. */
reportsRouter.get("/finance", async (req, res) => {
  res.json(financeReport(await buildReportContext(parseFilter(req.query))));
});

/** `GET /reports/revenue` — by qualification and by sales agent. */
reportsRouter.get("/revenue", async (req, res) => {
  res.json(revenueReport(await buildReportContext(parseFilter(req.query))));
});

/** `GET /reports/margin` — where the profit is, by qualification. */
reportsRouter.get("/margin", async (req, res) => {
  res.json(marginReport(await buildReportContext(parseFilter(req.query))));
});

/** `GET /reports/funnel` — orders by workflow stage. */
reportsRouter.get("/funnel", async (req, res) => {
  res.json(funnelReport(await buildReportContext(parseFilter(req.query))));
});

/** `GET /reports/ageing` — overdue invoices bucketed by days past due. */
reportsRouter.get("/ageing", async (req, res) => {
  res.json(ageingReport(await buildReportContext(parseFilter(req.query))));
});

/** `GET /reports/collections` — invoiced vs collected by month. */
reportsRouter.get("/collections", async (req, res) => {
  res.json(collectionsReport(await buildReportContext(parseFilter(req.query))));
});

/** `GET /reports/rto-turnaround` — completion time by RTO. */
reportsRouter.get("/rto-turnaround", async (req, res) => {
  res.json(await rtoTurnaroundReport(parseFilter(req.query)));
});