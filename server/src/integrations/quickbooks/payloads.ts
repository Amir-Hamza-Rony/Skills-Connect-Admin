import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { Client, type ClientLean } from "../../models/client.model.js";
import { Invoice, type InvoiceLean } from "../../models/invoice.model.js";
import { Order, type OrderLean } from "../../models/order.model.js";
import { Payment, type PaymentLean } from "../../models/payment.model.js";
import { Qualification, type QualificationLean } from "../../models/qualification.model.js";

/**
 * Translates our finance records into QuickBooks API bodies.
 *
 * ## Kept separate from the client
 *
 * The client knows how to talk HTTP; this knows what to say. Both are testable
 * without the other, and the mapping is where the real business decisions live
 * (which account an invoice hits, how a refund is expressed), so it deserves its
 * own file rather than being buried in a fetch call.
 *
 * ## Every failure is a named reason, never a guess
 *
 * A sync record's `syncError` is read by an operator deciding whether to retry.
 * "Customer not linked" is actionable; a generic 400 is not. Anything that would
 * produce an invalid QuickBooks payload is refused here, before the request.
 */

export interface PayloadResult {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

/** QuickBooks rejects `Date` objects over JSON, and wants `YYYY-MM-DD`. */
function toQBDate(date: Date | string): string {
  if (typeof date === "string") return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

/**
 * The service/item revenue account for enrolled-course invoices.
 *
 * Read from env rather than hardcoded: it is a configuration value in
 * QuickBooks, and re-pointing revenue to a different account must be an env
 * change, not a code edit. Defaults to "1", which is QuickBooks' first
 * Services income account.
 */
const INCOME_ACCOUNT_ID = env.QB_INCOME_ACCOUNT_ID;

/**
 * Builds an invoice body.
 *
 * Requires the linked QuickBooks customer — see `Client.qbCustomerId`. Returns a
 * failure rather than a payload missing `CustomerRef`, because QuickBooks would
 * reject it with an opaque 400 and the sync record would carry nothing useful.
 */
export async function buildInvoicePayload(invoiceId: string): Promise<PayloadResult> {
  const invoice = await Invoice.findById(invoiceId).lean<InvoiceLean | null>();
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status === "Void") {
    // A voided invoice must not be created in QuickBooks. Cancellation is a
    // separate QB operation and is deliberately out of B5 scope.
    return { ok: false, error: "Invoice is void and must not be created in QuickBooks." };
  }

  const order = await Order.findById(invoice.orderId).lean<OrderLean | null>();
  if (!order) return { ok: false, error: "Order not found for this invoice." };

  const client = await Client.findById(order.clientId).lean<ClientLean | null>();
  if (!client) return { ok: false, error: "Client not found for this order." };
  if (!client.qbCustomerId) {
    return {
      ok: false,
      error: `Client "${client.legalName}" is not linked to a QuickBooks customer — map it before syncing.`,
    };
  }

  const qualification = await Qualification.findById(order.qualificationId)
    .lean<QualificationLean | null>();
  const description = qualification
    ? `${qualification.code} — ${qualification.title}`
    : `Course enrolment (order ${String(order._id)})`;

  return {
    ok: true,
    payload: {
      CustomerRef: { value: client.qbCustomerId },
      // Our invoice number is authoritative; QB stores it rather than minting
      // its own, which is what makes the B6 reconciliation join possible.
      DocNumber: invoice.invoiceNumber,
      DueDate: toQBDate(invoice.dueDate),
      TxnDate: toQBDate(invoice.createdAt ?? new Date()),
      Line: [
        {
          Amount: invoice.total,
          DetailType: "SalesItemLineDetail",
          Description: description,
          SalesItemLineDetail: {
            Qty: 1,
            UnitPrice: invoice.total,
            IncomeAccountRef: { value: INCOME_ACCOUNT_ID },
          },
        },
      ],
    },
  };
}

/** Maps our payment method onto QuickBooks' payment type enum. */
function toQBPaymentType(method: string): string {
  switch (method) {
    case "Cash":
      return "Cash";
    case "Card":
      return "CreditCard";
    case "Bank Transfer":
      return "Check";
    default:
      return "Cash";
  }
}

/** Builds a payment body. Mirrors `buildInvoicePayload`'s contract. */
export async function buildPaymentPayload(paymentId: string): Promise<PayloadResult> {
  const payment = await Payment.findById(paymentId).lean<PaymentLean | null>();
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.status === "Void") {
    return { ok: false, error: "Payment is void and must not be created in QuickBooks." };
  }

  const order = await Order.findById(payment.orderId).lean<OrderLean | null>();
  if (!order) return { ok: false, error: "Order not found for this payment." };

  const client = await Client.findById(order.clientId).lean<ClientLean | null>();
  if (!client?.qbCustomerId) {
    return {
      ok: false,
      error: `Client "${client?.legalName ?? String(order.clientId)}" is not linked to a QuickBooks customer — map it before syncing.`,
    };
  }

  const payload: Record<string, unknown> = {
    CustomerRef: { value: client.qbCustomerId },
    TxnDate: toQBDate(payment.date),
    PaymentType: toQBPaymentType(payment.method),
    TotalAmt: payment.allocatedAmount > 0 ? payment.allocatedAmount : payment.amount,
  };

  // Linking the payment to its invoice is what stops QuickBooks leaving the
  // invoice open; without it the money lands as an unapplied deposit.
  if (payment.invoiceId) {
    payload.LinkedTxn = [{ TxnId: String(payment.invoiceId), TxnType: "Invoice" }];
  }
  if (payment.reference) {
    logger.debug({ paymentId }, "Payment carries a bank reference");
    payload.PrivateNote = payment.reference.slice(0, 500);
  }

  return { ok: true, payload };
}

/** Builds the payload for whichever entity a sync record refers to. */
export async function buildPayloadFor(
  entityType: "invoice" | "payment",
  entityId: string,
): Promise<PayloadResult> {
  return entityType === "invoice"
    ? buildInvoicePayload(entityId)
    : buildPaymentPayload(entityId);
}