import { Router } from "express";
import { z } from "zod";

import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { createInvoice, listInvoices, voidInvoice } from "../services/invoice.service.js";
import { addInstalment, listPlans } from "../services/payment-plan.service.js";
import {
  financeSummary,
  listPayments,
  recordPayment,
  refundPayment,
} from "../services/payment.service.js";
import { auditContextFrom } from "../services/audit.service.js";

export const invoicesRouter: Router = Router();

invoicesRouter.use(requireAuth);

/** `GET /invoices` — list, optionally filtered by order. */
invoicesRouter.get(
  "/",
  requirePermission("finance.view"),
  async (req, res) => {
    const orderId = typeof req.query.orderId === "string" ? req.query.orderId : undefined;
    res.json({ invoices: await listInvoices(orderId) });
  },
);

const invoiceBody = z.object({
  orderId: z.string().min(1),
  total: z.number().positive(),
  dueDate: z.string().min(1).max(10),
});

/** `POST /invoices` — create an invoice. */
invoicesRouter.post(
  "/",
  requirePermission("finance.manage"),
  async (req, res) => {
    const body = invoiceBody.parse(req.body);
    const invoice = await createInvoice(body, {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.status(201).json({ invoice });
  },
);

/** `POST /invoices/:id/void` — void an invoice. */
invoicesRouter.post(
  "/:id/void",
  requirePermission("finance.manage"),
  async (req, res) => {
    const invoice = await voidInvoice(param(req, "id"), {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.json({ invoice });
  },
);

/* ---------------- payment plans ---------------- */

export const plansRouter: Router = Router();

plansRouter.use(requireAuth);

/** `GET /payment-plans` — every plan, for the finance list. */
plansRouter.get(
  "/",
  requirePermission("finance.view"),
  async (_req, res) => {
    res.json({ plans: await listPlans() });
  },
);

const instalmentBody = z.object({
  dueDate: z.string().min(1).max(10),
  amount: z.number().positive(),
});

/** `POST /payment-plans/:id/instalments` — append an instalment. */
plansRouter.post(
  "/:id/instalments",
  requirePermission("finance.manage"),
  async (req, res) => {
    const body = instalmentBody.parse(req.body);
    const plan = await addInstalment(
      { planId: param(req, "id"), dueDate: body.dueDate, amount: body.amount },
      { ...auditContextFrom(req), id: req.auth!.userId, email: req.auth!.email },
    );
    res.status(201).json({ plan });
  },
);

/* ---------------- payments ---------------- */

export const paymentsRouter: Router = Router();

paymentsRouter.use(requireAuth);

/** `GET /payments` — list, optionally filtered by order. */
paymentsRouter.get(
  "/",
  requirePermission("finance.view"),
  async (req, res) => {
    const orderId = typeof req.query.orderId === "string" ? req.query.orderId : undefined;
    res.json({ payments: await listPayments(orderId) });
  },
);

const paymentBody = z.object({
  orderId: z.string().min(1),
  invoiceId: z.string().max(24).nullable().optional(),
  amount: z.number().positive(),
  date: z.string().min(1).max(10),
  method: z.enum(["Bank Transfer", "Card", "Cash", "Other"]),
  reference: z.string().max(120).optional(),
});

/** `POST /payments` — record a payment and allocate it across the plan. */
paymentsRouter.post(
  "/",
  requirePermission("finance.manage"),
  async (req, res) => {
    const body = paymentBody.parse(req.body);
    const payment = await recordPayment(body, {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.status(201).json({ payment });
  },
);

/** `POST /payments/:id/refund` — refund a payment. */
paymentsRouter.post(
  "/:id/refund",
  requirePermission("finance.manage"),
  async (req, res) => {
    const payment = await refundPayment(param(req, "id"), {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.json({ payment });
  },
);

/* ---------------- finance summary ---------------- */

/**
 * `GET /finance/summary` — the dashboard and report numbers.
 *
 * On its own router because the URL is `/finance/summary`, not
 * `/payments/finance/summary`; mounting it on the payments router would put it
 * under the wrong prefix.
 */
export const financeRouter: Router = Router();

financeRouter.use(requireAuth);

financeRouter.get(
  "/summary",
  requirePermission("finance.view"),
  async (req, res) => {
    const orderId = typeof req.query.orderId === "string" ? req.query.orderId : undefined;
    res.json(await financeSummary(orderId));
  },
);
