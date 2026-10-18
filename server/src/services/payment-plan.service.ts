import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { PaymentPlan, type PaymentPlanLean } from "../models/payment-plan.model.js";
import { recordAudit } from "./audit.service.js";
import { refreshInvoiceStatuses, type FinanceActor } from "./payment.service.js";

/** Shape the API returns — `_id` stringified to `id`. */
export type PaymentPlanDTO = Omit<PaymentPlanLean, "_id"> & { id: string };

export function toPlanDTO(doc: PaymentPlanLean): PaymentPlanDTO {
  const { _id, ...rest } = doc;
  return { ...rest, id: String(_id) };
}

/** `GET /orders/:id/payment-plan` — the plan for one order, if it has one. */
export async function getPlan(orderId: string): Promise<PaymentPlanDTO | null> {
  if (!Types.ObjectId.isValid(orderId)) return null;
  const doc = await PaymentPlan.findOne({ orderId: new Types.ObjectId(orderId) }).lean<PaymentPlanLean>();
  return doc ? toPlanDTO(doc) : null;
}

/** `GET /payment-plans` — every plan, for the finance list view. */
export async function listPlans(): Promise<PaymentPlanDTO[]> {
  const docs = await PaymentPlan.find().sort({ createdAt: -1 }).lean<PaymentPlanLean[]>();
  return docs.map(toPlanDTO);
}

export interface CreatePlanInput {
  orderId: string;
  total: number;
}

/**
 * `POST /orders/:id/payment-plan`
 *
 * One plan per order (the `orderId` unique index enforces it). Creating a second
 * plan for an order would make "how much is this order owed?" ambiguous, so the
 * first one wins and the request is refused.
 */
export async function createPlan(
  input: CreatePlanInput,
  actor: FinanceActor,
): Promise<PaymentPlanDTO> {
  if (!Types.ObjectId.isValid(input.orderId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid order id.");
  }
  if (!Number.isFinite(input.total) || input.total <= 0) {
    throw AppError.badRequest("INVALID_TOTAL", "Total must be a positive number.");
  }

  const { Order } = await import("../models/order.model.js");
  const order = await Order.findById(input.orderId).lean();
  if (!order) throw AppError.notFound("Order not found.");

  const existing = await PaymentPlan.findOne({ orderId: order._id }).lean();
  if (existing) {
    throw new AppError(
      409,
      "PLAN_EXISTS",
      "This order already has a payment plan. Add instalments to it instead.",
    );
  }

  const doc = await PaymentPlan.create({
    orderId: order._id,
    total: input.total,
    instalments: [],
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "payment_plan.create",
    entityType: "payment_plan",
    entityId: String(doc._id),
    after: { orderId: input.orderId, total: input.total },
  });

  return toPlanDTO(doc.toObject() as PaymentPlanLean);
}

export interface AddInstalmentInput {
  planId: string;
  dueDate: string;
  amount: number;
}

/**
 * `POST /payment-plans/:id/instalments`
 *
 * Appends an instalment. There is deliberately no cap on the number of
 * instalments (UAT criterion 4) — the plan total is the sum of its parts, not a
 * constraint on how many parts there are.
 */
export async function addInstalment(
  input: AddInstalmentInput,
  actor: FinanceActor,
): Promise<PaymentPlanDTO> {
  if (!Types.ObjectId.isValid(input.planId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid plan id.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw AppError.badRequest("INVALID_AMOUNT", "Amount must be a positive number.");
  }

  const plan = await PaymentPlan.findById(input.planId);
  if (!plan) throw AppError.notFound("Payment plan not found.");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${input.dueDate}T00:00:00.000Z`);

  const doc = await PaymentPlan.findOneAndUpdate(
    { _id: plan._id },
    {
      $push: {
        instalments: {
          id: new Types.ObjectId().toString(),
          dueDate: due,
          amount: input.amount,
          paidAmount: 0,
          status: due < today ? "Due" : "Pending",
        },
      },
    },
    { returnDocument: "after" },
  );

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "payment_plan.add_instalment",
    entityType: "payment_plan",
    entityId: String(plan._id),
    after: { dueDate: input.dueDate, amount: input.amount },
  });

  await refreshInvoiceStatuses(plan.orderId);

  return toPlanDTO(doc!.toObject() as PaymentPlanLean);
}
