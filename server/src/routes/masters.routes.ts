import { Router, type Request } from "express";
import { z } from "zod";

import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { auditContextFrom } from "../services/audit.service.js";
import {
  createAgent,
  createQualification,
  createRto,
  createSupplierRoute,
  expireSupplierRoute,
  listAgents,
  listQualifications,
  listRtos,
  listSupplierRoutes,
  updateAgent,
  type Actor,
} from "../services/masters.service.js";

/**
 * Master data routes (BACKEND-PLAN §4, B3).
 *
 * These four collections — agents, qualifications, RTOs and supplier routes —
 * were modelled in B3 but never exposed. The frontend ran them off the in-memory
 * preview store, so the pricing matrix on screen was not the matrix an order
 * snapshotted its cost from.
 *
 * Each group has its own permission because they are owned by different roles:
 * the RTO/Sourcing manager maintains agents and pricing; nobody but an admin
 * should be able to change a qualification catalogue entry.
 */

function actorOf(req: Request): Actor {
  return {
    ...auditContextFrom(req),
    id: req.auth!.userId,
    email: req.auth!.email,
  };
}

/* ------------------------------- agents ------------------------------- */

export const agentsRouter: Router = Router();

agentsRouter.use(requireAuth);

/** `GET /agents` — list, filterable by type and active state. */
agentsRouter.get(
  "/",
  requirePermission("agents.manage"),
  async (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const active = req.query.active === undefined ? undefined : req.query.active === "true";

    res.json({
      agents: await listAgents({
        type: type === "sales_closing" || type === "certificate_source" || type === "rto_contact"
          ? type
          : undefined,
        active,
        search,
      }),
    });
  },
);

const agentBody = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(["sales_closing", "certificate_source", "rto_contact"]),
  contact: z.string().trim().max(120).default(""),
  commissionRule: z.string().trim().max(200).default(""),
  active: z.boolean().default(true),
});

/** `POST /agents` */
agentsRouter.post(
  "/",
  requirePermission("agents.manage"),
  async (req, res) => {
    const body = agentBody.parse(req.body);
    res.status(201).json({ agent: await createAgent(body, actorOf(req)) });
  },
);

/** `PATCH /agents/:id` */
agentsRouter.patch(
  "/:id",
  requirePermission("agents.manage"),
  async (req, res) => {
    const body = agentBody.partial().parse(req.body);
    const agent = await updateAgent(param(req, "id"), body, actorOf(req));
    if (!agent) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Agent not found." } });
      return;
    }
    res.json({ agent });
  },
);

/* --------------------------- qualifications --------------------------- */

export const qualificationsRouter: Router = Router();

qualificationsRouter.use(requireAuth);

const licensingRefBody = z.object({
  industry: z.string().trim().min(1).max(120),
  authority: z.string().trim().min(1).max(160),
  prerequisites: z.string().trim().max(500).default(""),
  outcome: z.string().trim().max(500).default(""),
});

const qualificationBody = z.object({
  code: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(240),
  trainingPackage: z.string().trim().max(32).default(""),
  industry: z.string().trim().max(160).default(""),
  status: z.enum(["current", "superseded"]).default("current"),
  licensingRefs: z.array(licensingRefBody).default([]),
});

/** `GET /qualifications` */
qualificationsRouter.get(
  "/",
  requirePermission("qualifications.manage"),
  async (req, res) => {
    const status = req.query.status === "superseded" ? "superseded" : req.query.status === "current" ? "current" : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    res.json({ qualifications: await listQualifications({ status, search }) });
  },
);

/** `POST /qualifications` */
qualificationsRouter.post(
  "/",
  requirePermission("qualifications.manage"),
  async (req, res) => {
    const body = qualificationBody.parse(req.body);
    res.status(201).json({ qualification: await createQualification(body, actorOf(req)) });
  },
);

/* --------------------------------- RTOs -------------------------------- */

export const rtosRouter: Router = Router();

rtosRouter.use(requireAuth);

const contactBody = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.string().trim().max(120).default(""),
  email: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(40).default(""),
});

const rtoBody = z.object({
  legalName: z.string().trim().min(1).max(240),
  tradingName: z.string().trim().max(240).default(""),
  rtoCode: z.string().trim().min(1).max(32),
  cricosCode: z.string().trim().max(32).nullable().default(null),
  contacts: z.array(contactBody).default([]),
  status: z.enum(["active", "suspended", "at-risk", "inactive"]).default("active"),
  complianceNote: z.string().trim().max(2000).default(""),
  website: z.string().trim().max(240).default(""),
});

/** `GET /rtos` */
rtosRouter.get(
  "/",
  requirePermission("rto.manage"),
  async (req, res) => {
    const status =
      req.query.status === "active" || req.query.status === "suspended" ||
      req.query.status === "at-risk" || req.query.status === "inactive"
        ? req.query.status
        : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    res.json({ rtos: await listRtos({ status, search }) });
  },
);

/** `POST /rtos` */
rtosRouter.post(
  "/",
  requirePermission("rto.manage"),
  async (req, res) => {
    const body = rtoBody.parse(req.body);
    res.status(201).json({ rto: await createRto(body, actorOf(req)) });
  },
);

/* ---------------------------- supplier routes ---------------------------- */

export const supplierRoutesRouter: Router = Router();

supplierRoutesRouter.use(requireAuth);

/** `GET /supplier-routes` — the pricing matrix. */
supplierRoutesRouter.get(
  "/",
  requirePermission("pricing.manage"),
  async (req, res) => {
    const q = req.query;
    res.json({
      routes: await listSupplierRoutes({
        status: q.status === "expired" ? "expired" : q.status === "active" ? "active" : undefined,
        qualificationId: typeof q.qualificationId === "string" ? q.qualificationId : undefined,
        sourceAgentId: typeof q.sourceAgentId === "string" ? q.sourceAgentId : undefined,
        rtoId: typeof q.rtoId === "string" ? q.rtoId : undefined,
      }),
    });
  },
);

const supplierRouteBody = z.object({
  qualificationId: z.string().min(1),
  sourceAgentId: z.string().min(1),
  rtoId: z.string().min(1),
  wholesaleCost: z.number().nonnegative(),
  effectiveFrom: z.string().max(10).optional(),
});

/**
 * `POST /supplier-routes`
 *
 * Adding a route is how a cost change is recorded: the old one is expired and a
 * new one created. Existing orders keep their snapshot either way.
 */
supplierRoutesRouter.post(
  "/",
  requirePermission("pricing.manage"),
  async (req, res) => {
    const body = supplierRouteBody.parse(req.body);
    res.status(201).json({ route: await createSupplierRoute(body, actorOf(req)) });
  },
);

/** `POST /supplier-routes/:id/expire` */
supplierRoutesRouter.post(
  "/:id/expire",
  requirePermission("pricing.manage"),
  async (req, res) => {
    const effectiveTo =
      typeof req.body?.effectiveTo === "string" ? req.body.effectiveTo : undefined;
    const route = await expireSupplierRoute(param(req, "id"), effectiveTo, actorOf(req));
    if (!route) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Supplier route not found." } });
      return;
    }
    res.json({ route });
  },
);