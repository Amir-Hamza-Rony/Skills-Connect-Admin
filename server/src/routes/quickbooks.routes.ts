import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  authorizationUrl,
  exchangeCodeForTokens,
  isQuickBooksConfigured,
  quickBooksStatus,
} from "../integrations/quickbooks/client.js";
import { queueDepth } from "../jobs/qb-sync.queue.js";
import { isWorkerRunning } from "../jobs/qb-sync.worker.js";
import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { recordAudit } from "../services/audit.service.js";
import { auditContextFrom } from "../services/audit.service.js";
import {
  listSyncRecords,
  retrySync,
  syncRecordFor,
} from "../services/qb-sync.service.js";
import { handleWebhook, verifyWebhookSignature, type QBWebhookPayload } from "../services/qb-webhook.service.js";

export const quickbooksRouter: Router = Router();

/* ------------------------------------------------------------------ *
 * Webhook — mounted before `requireAuth`, verified by signature instead.
 * ------------------------------------------------------------------ */

/**
 * `POST /integrations/quickbooks/webhook`
 *
 * Deliberately public: Intuit has no session, so authentication is the
 * `intuit-signature` HMAC over the raw body. `app.ts` mounts this router at
 * `/integrations/quickbooks/webhook` with `express.raw()` for exactly that
 * reason.
 *
 * The route is declared as `/` because the mount point already carries the
 * full path — declaring `/webhook` here would make the URL
 * `/integrations/quickbooks/webhook/webhook` and silently fall through to the
 * authenticated router below.
 *
 * Answers 200 for every *verified* payload, including ones that match nothing.
 * A non-2xx would make Intuit redeliver, so verification failures are recorded
 * and dropped rather than retried.
 */
export const qbWebhookRouter: Router = Router();

qbWebhookRouter.post("/", (req: Request, res: Response) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

  if (!verifyWebhookSignature(raw, req.get("intuit-signature") ?? undefined)) {
    res.status(401).json({
      error: {
        code: "INVALID_SIGNATURE",
        message: "Webhook signature verification failed.",
      },
    });
    return;
  }

  let payload: QBWebhookPayload;
  try {
    payload = JSON.parse(raw.toString("utf8")) as QBWebhookPayload;
  } catch {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Body is not valid JSON." } });
    return;
  }

  void handleWebhook(payload)
    .then((result) => res.json({ ok: true, matched: result.matched }))
    .catch(() =>
      // Never surface a 5xx to Intuit — it would retry a notification we have
      // already accepted.
      res.json({ ok: true, matched: 0 }),
    );
});

/* ------------------------------------------------------------------ *
 * Authenticated integration routes.
 * ------------------------------------------------------------------ */

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
 * `GET /integrations/quickbooks/sync/:type/:id` — one entity's sync state.
 *
 * Lets the invoice screen show why a sync failed without downloading the whole
 * queue.
 */
quickbooksRouter.get(
  "/sync/:type/:id",
  requirePermission("finance.view"),
  async (req, res) => {
    const type = param(req, "type");
    if (type !== "invoice" && type !== "payment") {
      res.status(400).json({
        error: { code: "INVALID_TYPE", message: "Type must be invoice or payment." },
      });
      return;
    }
    const record = await syncRecordFor(type, param(req, "id"));
    if (!record) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Sync record not found." } });
      return;
    }
    res.json({ record });
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

/**
 * `GET /integrations/quickbooks/status` — connection health.
 *
 * Reports whether the integration is configured, authorised and whether the
 * worker is running. Deliberately exposes no token material — `configured` and
 * `authorised` are booleans, nothing more.
 */
quickbooksRouter.get(
  "/status",
  requirePermission("finance.view"),
  async (_req, res) => {
    const [status, depth] = await Promise.all([quickBooksStatus(), queueDepth()]);
    res.json({
      ...status,
      worker: isWorkerRunning(),
      queue: depth,
      // Explains itself: why would a sync never succeed?
      hint: !status.configured
        ? "Set QB_REALM_ID, QB_CLIENT_ID and QB_CLIENT_SECRET to enable syncing."
        : !status.authorised
          ? "Authorise the company via /connect to enable syncing."
          : null,
    });
  },
);

/**
 * `GET /integrations/quickbooks/connect` — where to send an admin to authorise.
 *
 * Gated on `settings.manage` rather than `finance.*`: connecting a company is a
 * one-off administrative act with long-lived consequences, not a finance task.
 */
quickbooksRouter.get(
  "/connect",
  requirePermission("settings.manage"),
  async (req, res) => {
    if (!isQuickBooksConfigured()) {
      res.status(422).json({
        error: {
          code: "QB_NOT_CONFIGURED",
          message: "QuickBooks client credentials are not set.",
        },
      });
      return;
    }
    // The state is echoed back by the callback to bind the round trip to this
    // session; it is not a secret and is not trusted for anything else.
    res.json({ url: authorizationUrl(String(req.auth!.userId)) });
  },
);

const callbackBody = z.object({
  code: z.string().min(1),
  realmId: z.string().min(1),
  state: z.string().min(1),
  oauth_token: z.string().optional(),
});

/**
 * `GET /integrations/quickbooks/callback` — Intuit redirects here after consent.
 *
 * The `state` must equal the user id that started the flow. Without that check
 * anyone could bind their own QuickBooks company to the installation by luring
 * an admin into clicking a link.
 */
quickbooksRouter.get(
  "/callback",
  requirePermission("settings.manage"),
  async (req, res) => {
    const parsed = callbackBody.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "INVALID_CALLBACK", message: "Missing code, realmId or state." },
      });
      return;
    }
    const { code, realmId, state } = parsed.data;

    if (state !== String(req.auth!.userId)) {
      res.status(403).json({
        error: { code: "STATE_MISMATCH", message: "OAuth state does not match this session." },
      });
      return;
    }

    const result = await exchangeCodeForTokens(code, realmId);
    if (!result.ok) {
      res.status(422).json({
        error: { code: "QB_TOKEN_EXCHANGE_FAILED", message: result.error ?? "Token exchange failed." },
      });
      return;
    }

    await recordAudit({
      ...auditContextFrom(req),
      action: "qb.connect",
      entityType: "qb_connection",
      entityId: realmId,
      after: { realmId },
    });

    res.json({ connected: true, realmId });
  },
);