import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { Certificate } from "../models/certificate.model.js";
import {
  DOCUMENT_CHECKLIST,
  DocumentRequirement,
} from "../models/document-requirement.model.js";
import { Document } from "../models/document.model.js";
import { Invoice } from "../models/invoice.model.js";
import { Order, type OrderAttrs, type OrderLean } from "../models/order.model.js";
import { Payment } from "../models/payment.model.js";
import { WorkflowTask } from "../models/workflow-task.model.js";
import { SupplierRoute } from "../models/supplier-route.model.js";
import { Client } from "../models/client.model.js";
import { recordAudit } from "./audit.service.js";
import { withTransaction } from "../lib/transaction.js";
import { isOrderStatus, type OrderStatus } from "../types/workflow.js";

/**
 * Order status state machine — Spec §5.
 *
 * Defines which transitions are permitted. Terminal states (Lost, Cancelled,
 * Refunded, Completed) have no outgoing edges. On Hold can return to any
 * non-terminal onboarding/submission/assessment/completion stage.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Lead: ["Qualified", "Lost"],
  Qualified: ["Won", "Lost"],
  Won: ["New", "Lost"],
  Lost: [],
  New: ["Awaiting Payment", "Awaiting Documents", "On Hold", "Cancelled"],
  "Awaiting Payment": ["Awaiting Documents", "On Hold", "Cancelled", "Refunded"],
  "Awaiting Documents": ["Documents Under Review", "On Hold", "Cancelled"],
  "Documents Under Review": ["Ready for Submission", "On Hold", "Rework Required"],
  "Ready for Submission": ["Submitted to Source Agent", "On Hold"],
  "Submitted to Source Agent": ["Submitted to RTO", "On Hold"],
  "Submitted to RTO": ["RTO Acknowledged", "On Hold"],
  "RTO Acknowledged": ["Under Assessment", "On Hold"],
  "Under Assessment": ["Additional Evidence Required", "Approved", "On Hold"],
  "Additional Evidence Required": ["Under Assessment", "Rework Required", "On Hold"],
  "Rework Required": ["Under Assessment", "On Hold"],
  Approved: ["Certificate Issued", "On Hold"],
  "Certificate Issued": ["Completed", "On Hold"],
  "On Hold": [
    "New",
    "Awaiting Payment",
    "Awaiting Documents",
    "Documents Under Review",
    "Ready for Submission",
    "Submitted to Source Agent",
    "Submitted to RTO",
    "RTO Acknowledged",
    "Under Assessment",
    "Additional Evidence Required",
    "Rework Required",
    "Approved",
    "Certificate Issued",
    "Cancelled",
  ],
  Completed: [],
  Cancelled: [],
  Refunded: [],
};

/**
 * Computes payment status from invoice total, amount paid, and overdue flag.
 * Spec §6: payment status should be calculated, not manually typed.
 */
export function computePaymentStatus(
  invoiceTotal: number,
  amountPaid: number,
  hasOverdue: boolean,
): "Unpaid" | "Part Paid" | "Paid" | "Overdue" | "Refunded" {
  if (amountPaid <= 0) return "Unpaid";
  if (hasOverdue) return "Overdue";
  if (amountPaid >= invoiceTotal) return "Paid";
  return "Part Paid";
}

export interface OrderActor {
  id: string;
  email: string;
  ip?: string | null;
  requestId?: string | null;
}

type HistoryEntry = OrderAttrs["history"][number];

/** Shape the API returns — `_id` and refs stringified, dates as ISO. */
export type OrderDTO = Omit<
  OrderAttrs,
  "clientId" | "qualificationId" | "salesAgentId" | "sourceAgentId" | "rtoId" | "history"
> & {
  id: string;
  clientId: string;
  qualificationId: string;
  salesAgentId: string;
  sourceAgentId: string;
  rtoId: string;
  paymentStatus: "Unpaid" | "Part Paid" | "Paid" | "Overdue" | "Refunded";
  history: Array<{
    timestamp: Date;
    actorId: string | null;
    field: string;
    before: string;
    after: string;
  }>;
};

export interface PaymentInfo {
  invoiceTotal: number;
  amountPaid: number;
  hasOverdue: boolean;
}

export function toOrderDTO(
  doc: OrderLean,
  paymentInfo?: PaymentInfo,
): OrderDTO {
  return {
    ...doc,
    id: String(doc._id),
    clientId: String(doc.clientId),
    qualificationId: String(doc.qualificationId),
    salesAgentId: String(doc.salesAgentId),
    sourceAgentId: String(doc.sourceAgentId),
    rtoId: String(doc.rtoId),
    paymentStatus: paymentInfo
      ? computePaymentStatus(
          paymentInfo.invoiceTotal,
          paymentInfo.amountPaid,
          paymentInfo.hasOverdue,
        )
      : "Unpaid",
    history: doc.history.map((h) => ({
      timestamp: h.timestamp,
      actorId: h.actorId ? String(h.actorId) : null,
      field: h.field,
      before: h.before,
      after: h.after,
    })),
  };
}

export interface OrderListQuery {
  status?: OrderStatus;
  clientId?: string;
  rtoId?: string;
  salesAgentId?: string;
}

/** `GET /orders` — filtered list for the queue view. */
export async function listOrders(query: OrderListQuery = {}): Promise<OrderDTO[]> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.clientId && Types.ObjectId.isValid(query.clientId)) {
    filter.clientId = new Types.ObjectId(query.clientId);
  }
  if (query.rtoId && Types.ObjectId.isValid(query.rtoId)) {
    filter.rtoId = new Types.ObjectId(query.rtoId);
  }
  if (query.salesAgentId && Types.ObjectId.isValid(query.salesAgentId)) {
    filter.salesAgentId = new Types.ObjectId(query.salesAgentId);
  }

  const docs = await Order.find(filter).sort({ createdAt: -1 }).lean<OrderLean[]>();

  // Compute payment status per order from invoices + payments.
  const orderIds = docs.map((d) => d._id);
  const [invoices, payments] = await Promise.all([
    Invoice.find({ orderId: { $in: orderIds } }).lean(),
    Payment.find({ orderId: { $in: orderIds } }).lean(),
  ]);

  const invoiceTotals = new Map<string, number>();
  for (const inv of invoices) {
    const cur = invoiceTotals.get(String(inv.orderId)) ?? 0;
    invoiceTotals.set(String(inv.orderId), cur + inv.total);
  }

  const paidByOrder = new Map<string, number>();
  const overdueByOrder = new Map<string, boolean>();
  const now = new Date();
  for (const p of payments) {
    // Only money that actually landed counts toward the paid total. Refunded
    // and voided payments do not.
    if (p.status === "Refunded" || p.status === "Void") continue;
    const cur = paidByOrder.get(String(p.orderId)) ?? 0;
    paidByOrder.set(String(p.orderId), cur + p.amount);
  }
  for (const inv of invoices) {
    // An invoice past its due date with a balance still owing marks the order
    // overdue.
    if (inv.status === "Paid" || inv.status === "Void") continue;
    if (new Date(inv.dueDate) < now) {
      overdueByOrder.set(String(inv.orderId), true);
    }
  }

  return docs.map((doc) => {
    const orderIdStr = String(doc._id);
    const paymentInfo: PaymentInfo = {
      invoiceTotal: invoiceTotals.get(orderIdStr) ?? 0,
      amountPaid: paidByOrder.get(orderIdStr) ?? 0,
      hasOverdue: overdueByOrder.get(orderIdStr) ?? false,
    };
    return toOrderDTO(doc, paymentInfo);
  });
}

export async function getOrder(id: string): Promise<OrderDTO | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await Order.findById(id).lean<OrderLean>();
  if (!doc) return null;

  const [invoices, payments] = await Promise.all([
    Invoice.find({ orderId: new Types.ObjectId(id) }).lean(),
    Payment.find({ orderId: new Types.ObjectId(id) }).lean(),
  ]);

  const invoiceTotal = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const amountPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const now = new Date();
  const hasOverdue = invoices.some(
    (inv) => new Date(inv.dueDate) < now && inv.status !== "Paid" && inv.status !== "Void",
  );

  return toOrderDTO(doc, { invoiceTotal, amountPaid, hasOverdue });
}

export interface CreateOrderInput {
  clientId: string;
  qualificationId: string;
  salesAgentId: string;
  sourceAgentId: string;
  rtoId: string;
  sellingPrice: number;
  otherCost?: number;
}

/**
 * `POST /clients/:clientId/orders`
 *
 * The wholesale cost is read from the active supplier route **here**, never
 * accepted from the caller. That is what makes the snapshot trustworthy: a
 * client cannot post `supplierCostSnapshot: 0` and invent a margin.
 *
 * If no active route matches, the order is rejected rather than created with a
 * zero snapshot — a zero cost would corrupt every downstream margin figure in
 * a way that would look like a legitimate discount.
 */
export async function createOrder(
  input: CreateOrderInput,
  actor: OrderActor,
): Promise<OrderDTO> {
  const ids = {
    clientId: input.clientId,
    qualificationId: input.qualificationId,
    salesAgentId: input.salesAgentId,
    sourceAgentId: input.sourceAgentId,
    rtoId: input.rtoId,
  };
  for (const [field, value] of Object.entries(ids)) {
    if (!Types.ObjectId.isValid(value)) {
      throw AppError.badRequest("INVALID_ID", `Invalid ${field}.`);
    }
  }

  const route = await SupplierRoute.findOne({
    qualificationId: ids.qualificationId,
    sourceAgentId: ids.sourceAgentId,
    rtoId: ids.rtoId,
    status: "active",
  }).lean();

  if (!route) {
    throw AppError.unprocessable(
      "NO_ACTIVE_ROUTE",
      "No active supplier route matches this qualification, source agent and RTO. Create the route before taking the order.",
    );
  }

  const exists = await Client.exists({ _id: ids.clientId });
  if (!exists) {
    throw new AppError(404, "CLIENT_NOT_FOUND", "Client not found.");
  }

  const now = new Date();
  const actorObjectId = new Types.ObjectId(actor.id);

  const docs = await withTransaction((session) =>
    Order.create(
      [
        {
          clientId: new Types.ObjectId(ids.clientId),
          qualificationId: new Types.ObjectId(ids.qualificationId),
          salesAgentId: new Types.ObjectId(ids.salesAgentId),
          sourceAgentId: new Types.ObjectId(ids.sourceAgentId),
          rtoId: new Types.ObjectId(ids.rtoId),
          status: "New",
          evidenceStatus: "Not Started",
          rtoSubmissionStatus: "Not Ready",
          certificateStatus: "Not Issued",
          sellingPrice: input.sellingPrice,
          supplierCostSnapshot: route.wholesaleCost,
          otherCost: input.otherCost ?? 0,
          currency: "AUD",
          completedAt: null,
          history: [
            { timestamp: now, actorId: actorObjectId, field: "status", before: "—", after: "New" },
          ],
        },
      ],
      session ? { session } : {},
    ),
  );

  const created = docs[0];
  if (!created) throw new Error("Failed to create order.");

  // Open the order's checklist and its certificate record. Both collections were
  // modelled in B3 but nothing ever wrote a row, so the checklist a client is
  // asked for and the certificate the order claims to be tracking were both
  // empty until something outside the API created them.
  await Promise.all([
    DocumentRequirement.insertMany(
      DOCUMENT_CHECKLIST.map((type) => ({
        orderId: created._id,
        type,
        required: true,
        status: "Not Received" as const,
        documentId: null,
      })),
      { ordered: false },
    ),
    Certificate.create({ orderId: created._id, status: "Not Issued" }),
  ]);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "order.create",
    entityType: "order",
    entityId: String(created._id),
    after: {
      clientId: ids.clientId,
      qualificationId: ids.qualificationId,
      sellingPrice: input.sellingPrice,
      supplierCostSnapshot: route.wholesaleCost,
      snapshotSourceRoute: String(route._id),
    },
  });

  // The onboarding task a manual create would also add, so the board and the
  // order agree from the first request.
  await WorkflowTask.create({
    orderId: created._id,
    stage: "Onboarding",
    title: "Send document checklist to client",
    assigneeId: null,
    dueDate: null,
    status: "Todo",
    priority: "Medium",
  });

  const doc = await Order.findById(created._id).lean<OrderLean>();
  return toOrderDTO(doc!);
}

/**
 * The task the workflow board should carry when an order enters a stage.
 *
 * Only stages that need a human to *do* something get one. Terminal and
 * automatic states (New, Lost, Cancelled) do not — otherwise the board fills
 * with items nobody can act on.
 */
const STAGE_TASKS: Partial<
  Record<OrderStatus, { stage: string; title: string; priority: "Low" | "Medium" | "High" }>
> = {
  "Awaiting Documents": {
    stage: "Onboarding",
    title: "Send document checklist to client",
    priority: "Medium",
  },
  "Documents Under Review": {
    stage: "Onboarding",
    title: "Review submitted documents",
    priority: "High",
  },
  "Ready for Submission": {
    stage: "Submission",
    title: "Prepare RTO submission pack",
    priority: "High",
  },
  "Submitted to Source Agent": {
    stage: "Submission",
    title: "Confirm source agent acknowledgement",
    priority: "Medium",
  },
  "Additional Evidence Required": {
    stage: "Assessment",
    title: "Request additional evidence from client",
    priority: "High",
  },
  "Rework Required": {
    stage: "Assessment",
    title: "Address RTO rework comments",
    priority: "High",
  },
  Approved: {
    stage: "Completion",
    title: "Request certificate from RTO",
    priority: "High",
  },
};

/**
 * `PATCH /orders/:id/status` — a status transition.
 *
 * Writes the history entry **and** the stage task in one transaction, which is
 * the B3 acceptance criterion: an order can never end up transitioned with no
 * record of who moved it, or with a record but no work item.
 *
 * `supplierCostSnapshot` is not writable here. The pre-update hooks on the
 * order schema strip it from any update, so a caller that tries to change it in
 * the same request gets the status change only.
 */
export async function transitionOrder(
  id: string,
  to: OrderStatus,
  actor: OrderActor,
): Promise<OrderDTO | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  if (!isOrderStatus(to)) {
    throw AppError.badRequest("INVALID_STATUS", `"${to}" is not a valid order status.`);
  }

  const existing = await Order.findById(id).lean<OrderLean>();
  if (!existing) return null;
  const before = existing.status;

  // State machine validation — Spec §5.
  const allowed = ALLOWED_TRANSITIONS[before];
  if (!allowed.includes(to)) {
    throw AppError.badRequest(
      "INVALID_TRANSITION",
      `Cannot move order from "${before}" to "${to}". Allowed next statuses: ${allowed.join(", ") || "none (terminal state)"}.`,
    );
  }

  const task = STAGE_TASKS[to];

  // Both writes run INSIDE the transaction. The task upsert used to sit outside
  // it, so a crash between the two left an order transitioned with no work item
  // — precisely the outcome this function claims cannot happen.
  const updated = await withTransaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          status: to,
          updatedAt: new Date(),
          ...(to === "Completed" ? { completedAt: new Date() } : {}),
        },
        $push: {
          history: {
            timestamp: new Date(),
            actorId: new Types.ObjectId(actor.id),
            field: "status",
            before,
            after: to,
          },
        },
      },
      { returnDocument: "after", session: session ?? undefined },
    ).lean<OrderLean | null>();

    if (order && task) {
      await WorkflowTask.findOneAndUpdate(
        { orderId: order._id, stage: task.stage, title: task.title },
        {
          $setOnInsert: {
            orderId: order._id,
            stage: task.stage,
            title: task.title,
            assigneeId: null,
            dueDate: null,
            status: "Todo",
            priority: task.priority,
          },
        },
        { upsert: true, session: session ?? undefined },
      );
    }

    return order;
  });

  if (!updated) return null;

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "order.status.change",
    entityType: "order",
    entityId: id,
    before,
    after: to,
  });

  return toOrderDTO(updated);
}

export interface DimensionPatch {
  evidenceStatus?: OrderAttrs["evidenceStatus"];
  rtoSubmissionStatus?: OrderAttrs["rtoSubmissionStatus"];
  /**
   * Writable here because the `certificates` collection is the record but this
   * denormalised field is what every list view reads. It was previously in the
   * schema with no endpoint that could ever set it, so the badge on the order
   * list was permanently "Not Issued" no matter what happened to the order.
   */
  certificateStatus?: OrderAttrs["certificateStatus"];
}

/**
 * `PATCH /orders/:id/dimensions` — the non-status workflow fields.
 *
 * Each changed field gets its own history row so the timeline reads as a
 * sequence of decisions rather than one blob.
 */
export async function updateOrderDimensions(
  id: string,
  patch: DimensionPatch,
  actor: OrderActor,
): Promise<OrderDTO | null> {
  if (!Types.ObjectId.isValid(id)) return null;

  const existing = await Order.findById(id).lean<OrderLean>();
  if (!existing) return null;

  const set: Record<string, unknown> = {};
  const entries: Array<{ field: string; before: string; after: string }> = [];

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === existing[field as keyof OrderLean]) continue;
    set[field] = value;
    entries.push({ field, before: String(existing[field as keyof OrderLean]), after: String(value) });
  }

  if (entries.length === 0) {
    throw AppError.badRequest("NO_CHANGES", "No changes supplied.");
  }

  set.updatedAt = new Date();

  const historyPush = entries.map((entry) => ({
    timestamp: new Date(),
    actorId: new Types.ObjectId(actor.id),
    field: entry.field,
    before: entry.before,
    after: entry.after,
  }));

  await withTransaction(async (session) =>
    Order.updateOne(
      { _id: existing._id },
      { $set: set, $push: { history: { $each: historyPush } } },
      session ? { session } : {},
    ),
  );

  for (const entry of entries) {
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
      action: `order.${entry.field}.change`,
      entityType: "order",
      entityId: id,
      before: entry.before,
      after: entry.after,
    });
  }

  const updated = await Order.findById(id).lean<OrderLean>();
  return updated ? toOrderDTO(updated) : null;
}

/** `GET /orders/:id/timeline` — every event that touched this order, oldest first. */
export async function orderTimeline(id: string): Promise<Array<Record<string, unknown>>> {
  if (!Types.ObjectId.isValid(id)) return [];
  const order = await Order.findById(id).lean<OrderLean>();
  if (!order) return [];

  const events: Array<Record<string, unknown>> = order.history.map((h: HistoryEntry) => ({
    kind: "status",
    timestamp: h.timestamp.toISOString(),
    actorId: h.actorId ? String(h.actorId) : null,
    field: h.field,
    before: h.before,
    after: h.after,
  }));

  // Invoices (Spec §14: timeline includes invoices)
  const invoices = await Invoice.find({ orderId: order._id }).lean();
  for (const inv of invoices) {
    events.push({
      kind: "invoice",
      timestamp: inv.createdAt.toISOString(),
      actorId: null,
      field: "invoice.created",
      before: "—",
      after: `${inv.invoiceNumber} · AUD ${inv.total}`,
    });
  }

  // Payments
  const payments = await Payment.find({ orderId: order._id }).lean();
  for (const p of payments) {
    events.push({
      kind: "payment",
      timestamp: p.createdAt.toISOString(),
      actorId: null,
      field: "payment.recorded",
      before: "—",
      after: `AUD ${p.amount} · ${p.method} · ${p.status}`,
    });
  }

  // Documents
  const docs = await Document.find({ orderId: order._id }).lean();
  for (const d of docs) {
    events.push({
      kind: "document",
      timestamp: d.createdAt.toISOString(),
      actorId: d.reviewedBy ? String(d.reviewedBy) : null,
      field: "document.uploaded",
      before: "—",
      after: `${d.type} v${d.version} · ${d.status}`,
    });
  }

  // Certificate
  const cert = await Certificate.findOne({ orderId: order._id }).lean();
  if (cert) {
    events.push({
      kind: "certificate",
      timestamp: cert.createdAt.toISOString(),
      actorId: null,
      field: "certificate.tracked",
      before: "—",
      after: cert.status,
    });
  }

  events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  return events;
}

/** Margin as the business defines it: price minus what the supplier charged. */
export function grossMargin(
  order: Pick<OrderAttrs, "sellingPrice" | "supplierCostSnapshot" | "otherCost">,
): number {
  return order.sellingPrice - order.supplierCostSnapshot - order.otherCost;
}

/** Exposed for tests and for the B5 finance phase's reconciliation. */
export async function snapshotOf(orderId: string): Promise<number | null> {
  const doc = await Order.findById(orderId).lean<OrderLean>();
  return doc ? doc.supplierCostSnapshot : null;
}
