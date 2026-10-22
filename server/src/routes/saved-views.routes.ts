import { Router } from "express";
import { z } from "zod";

import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { auditContextFrom } from "../services/audit.service.js";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
  type SavedViewActor,
} from "../services/saved-view.service.js";

export const savedViewsRouter: Router = Router();

savedViewsRouter.use(requireAuth);

/** `GET /saved-views?scope=orders|documents|finance|clients` */
savedViewsRouter.get(
  "/",
  requirePermission("orders.view"),
  async (req, res) => {
    const scope =
      req.query.scope === "orders" ||
      req.query.scope === "documents" ||
      req.query.scope === "finance" ||
      req.query.scope === "clients"
        ? req.query.scope
        : undefined;
    res.json({
      savedViews: await listSavedViews(req.auth!.userId, scope),
    });
  },
);

const savedViewBody = z.object({
  name: z.string().trim().min(1).max(120),
  scope: z.enum(["orders", "documents", "finance", "clients"]),
  filters: z.record(z.string(), z.unknown()).default({}),
  isDefault: z.boolean().optional(),
});

/** `POST /saved-views` */
savedViewsRouter.post(
  "/",
  requirePermission("orders.view"),
  async (req, res) => {
    const body = savedViewBody.parse(req.body);
    const view = await createSavedView(
      {
        userId: req.auth!.userId,
        name: body.name,
        scope: body.scope,
        filters: body.filters,
        isDefault: body.isDefault ?? false,
      },
      { ...auditContextFrom(req), id: req.auth!.userId, email: req.auth!.email },
    );
    res.status(201).json({ savedView: view });
  },
);

const savedViewPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

/** `PATCH /saved-views/:id` */
savedViewsRouter.patch(
  "/:id",
  requirePermission("orders.view"),
  async (req, res) => {
    const body = savedViewPatch.parse(req.body);
    const view = await updateSavedView(
      param(req, "id"),
      req.auth!.userId,
      body,
      { ...auditContextFrom(req), id: req.auth!.userId, email: req.auth!.email },
    );
    if (!view) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Saved view not found." } });
      return;
    }
    res.json({ savedView: view });
  },
);

/** `DELETE /saved-views/:id` */
savedViewsRouter.delete(
  "/:id",
  requirePermission("orders.view"),
  async (req, res) => {
    await deleteSavedView(param(req, "id"), req.auth!.userId);
    res.status(204).end();
  },
);

export type { SavedViewActor };
