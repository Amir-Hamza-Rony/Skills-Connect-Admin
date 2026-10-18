import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { Invoice, type InvoiceLean } from "../models/invoice.model.js";
import { PaymentPlan, type PaymentPlanLean } from "../models/payment-plan.model.js";
import { Payment, type PaymentAttrs, type PaymentLean } from "../models/payment.model.js";
import { recordAudit } from "./audit.service.js";
import { queueSync } from "./qb-sync.service.js";

export interface FinanceActor {
  id: string;
  email: string;
  ip?: string | null;
  requestId?: string | null;
}

export type PaymentDTO = Omit<PaymentAttrs, "orderId" | "invoiceId"> & {
  id: string;
  orderId: string;
  invoiceId: string | null;
};

export function toPaymentDTO(doc: PaymentLean): PaymentDTO {
  return {
    ...doc,
    id: String(doc._id),
    orderId: String(doc.orderId),
    invoiceId: doc.invoiceId ? String(doc.invoiceId) : null,
  };
}

/** `GET /payments` — optionally filtered by order. */
export async function listPayments(orderId?: string): Promise<PaymentDTO[]> {
  const filter = orderId && Types.ObjectId.isValid(orderId)
    ? { orderId: new Types.ObjectId(orderId) }
    : {};
  const docs = await Payment.find(filter).sort({ createdAt: -1 }).lean<PaymentLean[]>();
  return docs.map(toPaymentDTO);
}

/**
 * Distributes a payment across the order's plan instalments, oldest-due-first.
 *
 * This is the server-authoritative allocation the plan calls for: the caller
 * supplies an amount and the server decides where it goes. Steering money away
 * from an overdue instalment is not something a client gets to do.
 *
 * Instalments already `Waived`, `Cancelled` or `Paid` are skipped. Returns the
 * per-instalment breakdown and the total that found a target.
 */
/**
 * Pure allocation: returns where the money went and the resulting plan, without
 * touching the input.
 *
 * Kept pure on purpose — an earlier version mutated the instalments as it went
 * and the caller then applied the same allocations again, so every payment
 * counted twice. Returning the updated plan lets the caller persist exactly
 * what the function decided.
 */
export function allocateToPlan(
  plan: PaymentPlanLean,
  amount: number,
): {
  allocations: Array<{ instalmentId: string; amount: number }>;
  allocatedAmount: number;
  updated: PaymentPlanLean;
} {
  // Oldest due date first, so the payment always attacks the most overdue money.
  const ordered = [...plan.instalments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  let remaining = amount;
  const allocations: Array<{ instalmentId: string; amount: number }> = [];
  const instalments = ordered.map((inst) => ({ ...inst }));

  for (const inst of instalments) {
    if (remaining <= 0) break;
    if (inst.status === "Waived" || inst.status === "Cancelled" || inst.status === "Paid") continue;

    const outstanding = inst.amount - inst.paidAmount;
    if (outstanding <= 0) continue;

    const take = Math.min(outstanding, remaining);
    inst.paidAmount += take;
    remaining -= take;
    allocations.push({ instalmentId: inst.id, amount: take });

    inst.status = inst.paidAmount >= inst.amount ? "Paid" : "Part Paid";
  }

  return { allocations, allocatedAmount: amount - remaining, updated: { ...plan, instalments } };
}

/**
 * Recomputes the status of every non-void invoice on an order.
 *
 * Derived, not stored-as-truth: the status is a function of how much has been
 * paid against the invoice, so it is recalculated whenever a payment lands
 * rather than being updated by whatever code happened to write last.
 */
export async function refreshInvoiceStatuses(orderId: Types.ObjectId): Promise<void> {
  const invoices = await Invoice.find({ orderId }).lean<InvoiceLean[]>();
  const payments = await Payment.find({ orderId }).lean<PaymentLean[]>();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const inv of invoices) {
    if (inv.status === "Void" || inv.status === "Draft") continue;

    const paid = payments
      .filter(
        (p) =>
          p.invoiceId &&
          p.invoiceId.equals(inv._id) &&
          p.status !== "Void" &&
          p.status !== "Refunded",
      )
      .reduce((sum, p) => sum + p.allocatedAmount, 0);

    let status: InvoiceLean["status"];
    if (paid >= inv.total) status = "Paid";
    else if (paid > 0) status = "Part Paid";
    else if (inv.dueDate < today) status = "Overdue";
    else status = "Sent";

    if (status !== inv.status) {
      await Invoice.updateOne({ _id: inv._id }, { $set: { status } });
    }
  }
}

export interface RecordPaymentInput {
  orderId: string;
  invoiceId?: string | null;
  amount: number;
  date: string;
  method: PaymentAttrs["method"];
  reference?: string;
}

/**
 * `POST /payments`
 *
 * Records a payment and allocates it across the plan. If the order has no plan
 * yet, the payment is recorded as `Unallocated` rather than silently dropped —
 * the money is real even if no instalment exists to receive it, and the finance
 * team can allocate it by hand once a plan is created.
 */
export async function recordPayment(
  input: RecordPaymentInput,
  actor: FinanceActor,
): Promise<PaymentDTO> {
  if (!Types.ObjectId.isValid(input.orderId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid order id.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw AppError.badRequest("INVALID_AMOUNT", "Amount must be a positive number.");
  }

  const orderObjectId = new Types.ObjectId(input.orderId);
  const invoiceObjectId =
    input.invoiceId && Types.ObjectId.isValid(input.invoiceId)
      ? new Types.ObjectId(input.invoiceId)
      : null;

  if (invoiceObjectId) {
    const invoice = await Invoice.findById(invoiceObjectId).lean();
    if (!invoice) throw AppError.notFound("Invoice not found.");
    if (invoice.status === "Void") {
      throw AppError.unprocessable("INVOICE_VOID", "Cannot pay a voided invoice.");
    }
  }

  const plan = await PaymentPlan.findOne({ orderId: orderObjectId }).lean<PaymentPlanLean>();

  let allocations: Array<{ instalmentId: string; amount: number }> = [];
  let allocatedAmount = 0;

  if (plan) {
    const result = allocateToPlan(plan, input.amount);
    allocations = result.allocations;
    allocatedAmount = result.allocatedAmount;

    // Persist exactly what the allocator decided — no re-applying here.
    await PaymentPlan.updateOne(
      { orderId: orderObjectId },
      { $set: { instalments: result.updated.instalments } },
    );
  }

  const status: PaymentAttrs["status"] =
    allocatedAmount >= input.amount
      ? "Allocated"
      : allocatedAmount > 0
        ? "Partially Allocated"
        : "Unallocated";

  const doc = await Payment.create({
    orderId: orderObjectId,
    invoiceId: invoiceObjectId,
    amount: input.amount,
    date: new Date(`${input.date}T00:00:00.000Z`),
    method: input.method,
    reference: input.reference ?? "",
    allocations,
    allocatedAmount,
    status,
  });

  await refreshInvoiceStatuses(orderObjectId);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "payment.record",
    entityType: "payment",
    entityId: String(doc._id),
    after: {
      orderId: input.orderId,
      amount: input.amount,
      allocatedAmount,
      status,
      allocations,
    },
  });

  await queueSync("payment", doc._id, actor);

  const saved = await Payment.findById(doc._id).lean<PaymentLean>();
  return toPaymentDTO(saved!);
}

/**
 * `POST /payments/:id/refund`
 *
 * Refunds a payment by flipping its status and writing reversing allocations.
 * The row is never deleted — a refund is a fact about money that moved, and
 * deleting it would break every reconciliation that came after.
 */
export async function refundPayment(
  id: string,
  actor: FinanceActor,
): Promise<PaymentDTO> {
  const doc = await Payment.findById(id);
  if (!doc) throw AppError.notFound("Payment not found.");
  if (doc.status === "Refunded") {
    throw AppError.unprocessable("ALREADY_REFUNDED", "This payment has already been refunded.");
  }

  const before = { status: doc.status, allocatedAmount: doc.allocatedAmount };

  // Reverse the allocation so the instalments become payable again.
  if (doc.allocations.length > 0) {
    const plan = await PaymentPlan.findOne({ orderId: doc.orderId }).lean<PaymentPlanLean>();
    if (plan) {
      const byId = new Map(doc.allocations.map((a) => [a.instalmentId, a.amount]));
      for (const inst of plan.instalments) {
        const refunded = byId.get(inst.id);
        if (!refunded) continue;
        inst.paidAmount = Math.max(0, inst.paidAmount - refunded);
        inst.status =
          inst.paidAmount <= 0
            ? inst.dueDate < new Date()
              ? "Due"
              : "Pending"
            : "Part Paid";
      }
      await PaymentPlan.updateOne(
        { orderId: doc.orderId },
        { $set: { instalments: plan.instalments } },
      );
    }
  }

  doc.status = "Refunded";
  doc.allocatedAmount = 0;
  await doc.save();

  await refreshInvoiceStatuses(doc.orderId);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "payment.refund",
    entityType: "payment",
    entityId: String(doc._id),
    before,
    after: { status: "Refunded", allocatedAmount: 0 },
  });

  await queueSync("payment", doc._id, actor);

  return toPaymentDTO(doc.toObject() as PaymentLean);
}

export interface FinanceSummary {
  invoiced: number;
  paid: number;
  outstanding: number;
  overdue: number;
}

/**
 * `GET /finance/summary` — the numbers the dashboard and reports are built on.
 *
 * `overdue` is the unpaid portion of instalments whose due date has passed,
 * which is the figure a credit controller actually cares about.
 */
export async function financeSummary(orderId?: string): Promise<FinanceSummary> {
  const orderFilter = orderId && Types.ObjectId.isValid(orderId)
    ? { orderId: new Types.ObjectId(orderId) }
    : {};

  const invoices = await Invoice.find(orderFilter).lean<InvoiceLean[]>();
  const payments = await Payment.find(orderFilter).lean<PaymentLean[]>();

  const invoiced = invoices
    .filter((i) => i.status !== "Void")
    .reduce((sum, i) => sum + i.total, 0);

  const paid = payments
    .filter((p) => p.status !== "Void" && p.status !== "Refunded")
    .reduce((sum, p) => sum + p.allocatedAmount, 0);

  const planFilter = orderId && Types.ObjectId.isValid(orderId)
    ? { orderId: new Types.ObjectId(orderId) }
    : {};
  const plans = await PaymentPlan.find(planFilter).lean<PaymentPlanLean[]>();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdue = plans
    .flatMap((p) => p.instalments)
    .filter(
      (x) =>
        x.dueDate < today &&
        x.status !== "Paid" &&
        x.status !== "Waived" &&
        x.status !== "Cancelled",
    )
    .reduce((sum, x) => sum + (x.amount - x.paidAmount), 0);

  return { invoiced, paid, outstanding: Math.max(0, invoiced - paid), overdue };
}
