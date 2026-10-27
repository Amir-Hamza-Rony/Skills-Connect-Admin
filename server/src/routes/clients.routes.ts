import { Router } from "express";
import { z } from "zod";

import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import {
  createClient,
  duplicateReport,
  getClient,
  listClients,
  updateClient,
  type ClientListQuery,
} from "../services/client.service.js";
import { auditContextFrom } from "../services/audit.service.js";
import { isClientStatus } from "../types/workflow.js";

export const clientsRouter: Router = Router();

/**
 * Every client route needs at least `clients.view`. Mutations need
 * `clients.manage` — the same split the spec draws between reading the book of
 * business and writing to it.
 */
clientsRouter.use(requireAuth);

/** `GET /clients` — list with search, status and owning-agent filters. */
clientsRouter.get(
  "/",
  requirePermission("clients.view"),
  async (req, res) => {
    const query: ClientListQuery = {};
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      query.search = req.query.search;
    }
    if (typeof req.query.status === "string" && isClientStatus(req.query.status)) {
      query.status = req.query.status;
    }
    if (typeof req.query.sourceAgentId === "string") {
      query.sourceAgentId = req.query.sourceAgentId;
    }

    res.json({ clients: await listClients(query) });
  },
);

/**
 * `GET /clients/duplicates` — possible and certain duplicate people.
 *
 * Mounted before `/:id` so "duplicates" is never parsed as an ObjectId.
 */
clientsRouter.get(
  "/duplicates",
  requirePermission("clients.view"),
  async (_req, res) => {
    res.json(await duplicateReport());
  },
);

/** `GET /clients/:id` — one client, for the profile page. */
clientsRouter.get(
  "/:id",
  requirePermission("clients.view"),
  async (req, res) => {
    const client = await getClient(param(req, "id"));
    if (!client) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Client not found." } });
      return;
    }
    res.json({ client });
  },
);

const clientBody = z.object({
  legalName: z.string().trim().min(1).max(200),
  preferredName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(320),
  contacts: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        type: z.enum(["phone", "email", "whatsapp"]),
        value: z.string().trim().min(1).max(200),
        primary: z.boolean().optional(),
      }),
    )
    .optional(),
  addresses: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        street: z.string().trim().min(1).max(200),
        city: z.string().trim().min(1).max(100),
        state: z.string().trim().max(50).optional(),
        postalCode: z.string().trim().max(20).optional(),
        country: z.string().trim().max(50).optional(),
        primary: z.boolean().optional(),
      }),
    )
    .optional(),
  status: z
    .enum(["Prospect", "Active", "On Hold", "Inactive"])
    .optional(),
  sourceAgentId: z.string().max(24).nullable().optional(),
  notes: z.string().max(2000).optional(),
});

/** `POST /clients` — create a client. Requires `clients.manage`. */
clientsRouter.post(
  "/",
  requirePermission("clients.manage"),
  async (req, res) => {
    const body = clientBody.parse(req.body);
    const client = await createClient(body, {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.status(201).json({ client });
  },
);

/** `PATCH /clients/:id` — update a client. Requires `clients.manage`. */
clientsRouter.patch(
  "/:id",
  requirePermission("clients.manage"),
  async (req, res) => {
    const body = clientBody.partial().parse(req.body);
    const client = await updateClient(param(req, "id"), body, {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    if (!client) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Client not found." } });
      return;
    }
    res.json({ client });
  },
);
