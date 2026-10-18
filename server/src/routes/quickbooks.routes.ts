import { Router } from "express";

import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { listSyncRecords, retrySync } from "../services/qb-sync.service.js";
import { auditContextFrom } from "../services/audit.service.js";

export const quickbooksRouter: Router = Router();

quickbooksRouter.use(requireAuth);

/**
 * `GET /integrations/quickbooks/sync` — the sync queue.
 *
 * Readable with `finance.view` because the queue is part of the finance
 * workflow; retrying needs the separate `qb.retry` permission, since a retry can
 * create a real record in QuickBooks.
 */
quickbooksRouter.get(
  "/sync",
  requirePermission("finance.view"),
  async (_req, res) => {
    res.json({ records: await listSyncRecords() });
  },
);

/**
 * `POST /integrations/quickbooks/sync/:type/:id` — retry a sync.
 *
 * Gated on `qb.retry` rather than `finance.manage`: retrying is an integration
 * action with an external side effect, not a finance edit, and the spec gives it
 * its own permission.
 */
quickbooksRouter.post(
  "/sync/:type/:id",
  requirePermission("qb.retry"),
  async (req, res) => {
    const type = param(req, "type");
    if (type !== "invoice" && type !== "payment") {
      res.status(400).json({ error: { code: "INVALID_TYPE", message: "Type must be invoice or payment." } });
      return;
    }
    const record = await retrySync(type, param(req, "id"), {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.json({ record });
  },
);
