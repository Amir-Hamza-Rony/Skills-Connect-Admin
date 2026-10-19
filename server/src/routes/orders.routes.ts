import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import { param } from "../lib/params.js";
import { Certificate } from "../models/certificate.model.js";
import { DocumentRequirement } from "../models/document-requirement.model.js";
import { type OrderAttrs } from "../models/order.model.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import {
  createOrder,
  getOrder,
  listOrders,
  orderTimeline,
  transitionOrder,
  updateOrderDimensions,
  type OrderListQuery,
} from "../services/order.service.js";
import { listDocuments } from "../services/document.service.js";
import { createPlan, getPlan } from "../services/payment-plan.service.js";
import { auditContextFrom } from "../services/audit.service.js";
import { isOrderStatus } from "../types/workflow.js";

export const ordersRouter: Router = Router();

ordersRouter.use(requireAuth);

/** `GET /orders` — the queue view, filterable by status, client, RTO and agent. */
ordersRouter.get(
  "/",
  requirePermission("orders.view"),
  async (req, res) => {
    const query: OrderListQuery = {};
    if (typeof req.query.status === "string" && isOrderStatus(req.query.status)) {
      query.status = req.query.status;
    }
    if (typeof req.query.clientId === "string") query.clientId = req.query.clientId;
    if (typeof req.query.rtoId === "string") query.rtoId = req.query.rtoId;
    if (typeof req.query.salesAgentId === "string") {
      query.salesAgentId = req.query.salesAgentId;
    }

    res.json({ orders: await listOrders(query) });
  },
);

/** `GET /orders/:id` — one order with its embedded history. */
ordersRouter.get(
  "/:id",
  requirePermission("orders.view"),
  async (req, res) => {
    const order = await getOrder(param(req, "id"));
    if (!order) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
      return;
    }
    res.json({ order });
  },
);

/**
 * `GET /orders/:id/timeline` — every event on this order, oldest first.
 *
 * Declared before `/:id` so "timeline" is never parsed as an order id.
 */
ordersRouter.get(
  "/:id/timeline",
  requirePermission("orders.view"),
  async (req, res) => {
    res.json({ events: await orderTimeline(param(req, "id")) });
  },
);

/** `GET /orders/:id/payment-plan` — the plan for one order. */
ordersRouter.get(
  "/:id/payment-plan",
  requirePermission("finance.view"),
  async (req, res) => {
    const plan = await getPlan(param(req, "id"));
    if (!plan) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No payment plan for this order." } });
      return;
    }
    res.json({ plan });
  },
);

/** `POST /orders/:id/payment-plan` — create the plan for an order. */
ordersRouter.post(
  "/:id/payment-plan",
  requirePermission("finance.manage"),
  async (req, res) => {
    const body = z.object({ total: z.number().positive() }).parse(req.body);
    const plan = await createPlan(
      { orderId: param(req, "id"), total: body.total },
      { ...auditContextFrom(req), id: req.auth!.userId, email: req.auth!.email },
    );
    res.status(201).json({ plan });
  },
);

/**
 * `GET /orders/:id/documents` — the document list for one order.
 *
 * Lives on the orders router because the URL is `/orders/:id/documents`; the
 * documents router is mounted at `/documents` and cannot express that path
 * without doubling the prefix.
 */
ordersRouter.get(
  "/:id/documents",
  requirePermission("documents.view"),
  async (req, res) => {
    res.json({ documents: await listDocuments(param(req, "id")) });
  },
);

/**
 * `GET /orders/:id/checklist` — the document requirements opened with the order.
 *
 * The rows are created from `DOCUMENT_CHECKLIST` when the order is created, so
 * this is per-order *state* ("USI transcript approved, reference letter not
 * requested yet"), not a constant the client could render itself.
 */
ordersRouter.get(
  "/:id/checklist",
  requirePermission("documents.view"),
  async (req, res) => {
    const id = param(req, "id");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid order id." } });
      return;
    }
    const requirements = await DocumentRequirement.find({ orderId: new Types.ObjectId(id) })
      .sort({ type: 1 })
      .lean();
    res.json({ requirements });
  },
);

/**
 * `GET /orders/:id/certificate` — the certificate record for one order.
 *
 * Returns `null` for orders created before certificates existed, which the UI
 * already handles as "not tracked".
 */
ordersRouter.get(
  "/:id/certificate",
  requirePermission("orders.view"),
  async (req, res) => {
    const id = param(req, "id");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid order id." } });
      return;
    }
    const certificate = await Certificate.findOne({ orderId: new Types.ObjectId(id) }).lean();
    res.json({ certificate });
  },
);

const createOrderBody = z.object({
  clientId: z.string().min(1),
  qualificationId: z.string().min(1),
  salesAgentId: z.string().min(1),
  sourceAgentId: z.string().min(1),
  rtoId: z.string().min(1),
  sellingPrice: z.number().positive(),
  otherCost: z.number().min(0).optional(),
});

/**
 * `POST /clients/:clientId/orders`
 *
 * Nested under the client because an order cannot exist without one, and the
 * URL then states that invariant. The snapshot is taken server-side from the
 * active supplier route — the client never sends a cost.
 */
ordersRouter.post(
  "/",
  requirePermission("orders.manage"),
  async (req, res) => {
    const body = createOrderBody.parse(req.body);
    const order = await createOrder(body, {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.status(201).json({ order });
  },
);

const statusBody = z.object({ status: z.string().min(1) });

/** `PATCH /orders/:id/status` — move an order to a new status. */
ordersRouter.patch(
  "/:id/status",
  requirePermission("orders.manage"),
  async (req, res) => {
    const body = statusBody.parse(req.body);
    const order = await transitionOrder(param(req, "id"), body.status as OrderAttrs["status"], {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    if (!order) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
      return;
    }
    res.json({ order });
  },
);

const dimensionBody = z.object({
  evidenceStatus: z
    .enum(["Not Started", "In Progress", "Complete", "Additional Evidence Required"])
    .optional(),
  rtoSubmissionStatus: z
    .enum([
      "Not Ready",
      "Ready",
      "Submitted",
      "Acknowledged",
      "Under Assessment",
      "Additional Evidence Required",
      "Issued",
    ])
    .optional(),
  certificateStatus: z
    .enum(["Not Issued", "Pending", "Issued", "Certificate File Received", "Delivered to Client"])
    .optional(),
});

/** `PATCH /orders/:id/dimensions` — the non-status workflow fields. */
ordersRouter.patch(
  "/:id/dimensions",
  requirePermission("orders.manage"),
  async (req, res) => {
    const body = dimensionBody.parse(req.body);
    const order = await updateOrderDimensions(param(req, "id"), body, {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    if (!order) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found." } });
      return;
    }
    res.json({ order });
  },
);
