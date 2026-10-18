import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { Invoice, type InvoiceAttrs, type InvoiceLean } from "../models/invoice.model.js";
import { recordAudit } from "./audit.service.js";
import { refreshInvoiceStatuses, type FinanceActor } from "./payment.service.js";
import { queueSync } from "./qb-sync.service.js";

export type InvoiceDTO = Omit<InvoiceAttrs, "orderId"> & { id: string; orderId: string };

export function toInvoiceDTO(doc: InvoiceLean): InvoiceDTO {
  return { ...doc, id: String(doc._id), orderId: String(doc.orderId) };
}

/** `GET /invoices` — list, optionally filtered by order. */
export async function listInvoices(orderId?: string): Promise<InvoiceDTO[]> {
  const filter = orderId && Types.ObjectId.isValid(orderId)
    ? { orderId: new Types.ObjectId(orderId) }
    : {};
  const docs = await Invoice.find(filter).sort({ createdAt: -1 }).lean<InvoiceLean[]>();
  return docs.map(toInvoiceDTO);
}

/**
 * Atomically allocates the next invoice number.
 *
 * A counter document with `$inc` rather than "count the rows and add one",
 * because two concurrent creates would otherwise be issued the same number —
 * and a duplicate invoice number is far harder to unpick than a race.
 */
async function nextInvoiceNumber(): Promise<string> {
  const { Counter } = await import("../models/counter.model.js");
  const year = new Date().getFullYear();
  const doc = await Counter.findOneAndUpdate(
    { _id: `invoice-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return `INV-${year}-${String(doc!.seq).padStart(4, "0")}`;
}

export interface CreateInvoiceInput {
  orderId: string;
  total: number;
  dueDate: string;
}

/**
 * `POST /invoices`
 *
 * The number is allocated server-side, so a client cannot request a specific
 * number or collide with another create.
 */
export async function createInvoice(
  input: CreateInvoiceInput,
  actor: FinanceActor,
): Promise<InvoiceDTO> {
  if (!Types.ObjectId.isValid(input.orderId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid order id.");
  }
  if (!Number.isFinite(input.total) || input.total <= 0) {
    throw AppError.badRequest("INVALID_TOTAL", "Total must be a positive number.");
  }

  const { Order } = await import("../models/order.model.js");
  const order = await Order.findById(input.orderId).lean();
  if (!order) throw AppError.notFound("Order not found.");

  const invoiceNumber = await nextInvoiceNumber();

  // The initial status is derived, not assumed: an invoice created against a
  // past due date is Overdue from the first moment, not "Sent" until a payment
  // happens to trigger a refresh.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${input.dueDate}T00:00:00.000Z`);
  const status: InvoiceAttrs["status"] = due < today ? "Overdue" : "Sent";

  const doc = await Invoice.create({
    orderId: order._id,
    invoiceNumber,
    total: input.total,
    dueDate: due,
    status,
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "invoice.create",
    entityType: "invoice",
    entityId: String(doc._id),
    after: { invoiceNumber, total: input.total, dueDate: input.dueDate, orderId: input.orderId },
  });

  await queueSync("invoice", doc._id, actor);

  const saved = await Invoice.findById(doc._id).lean<InvoiceLean>();
  return toInvoiceDTO(saved!);
}

/**
 * `POST /invoices/:id/void`
 *
 * Voiding is terminal and irreversible. It is a status change, never a delete:
 * the invoice may already be referenced by payments and by the audit trail, and
 * removing it would orphan both.
 */
export async function voidInvoice(id: string, actor: FinanceActor): Promise<InvoiceDTO> {
  const doc = await Invoice.findById(id);
  if (!doc) throw AppError.notFound("Invoice not found.");
  if (doc.status === "Void") {
    throw AppError.unprocessable("ALREADY_VOID", "This invoice is already void.");
  }

  const before = { status: doc.status };
  doc.status = "Void";
  await doc.save();

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "invoice.void",
    entityType: "invoice",
    entityId: String(doc._id),
    before,
    after: { status: "Void" },
  });

  await queueSync("invoice", doc._id, actor);

  return toInvoiceDTO(doc.toObject() as InvoiceLean);
}

/** Recomputes statuses for an order's invoices after a payment change. */
export async function refreshForOrder(orderId: string): Promise<void> {
  if (!Types.ObjectId.isValid(orderId)) return;
  await refreshInvoiceStatuses(new Types.ObjectId(orderId));
}
