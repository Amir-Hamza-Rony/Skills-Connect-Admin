/**
 * Shared payment classification for finance reporting.
 *
 * The same definitions must be used by every finance aggregate so that
 * `collected` means the same thing everywhere:
 *
 *  - `collected`   — money allocated to a live (non-void) invoice.
 *  - `unallocated` — a receipt recorded without an invoice, or held outside
 *                    invoice allocation. It is real cash but is NOT invoice
 *                    collection and must never be folded into `collected`.
 *  - excluded      — void/refunded payments, and payments allocated to a void
 *                    invoice (those are neither collected nor unallocated).
 *
 * No FX conversion is performed here; callers group by the payment's own
 * currency.
 */

export interface PaymentLike {
  invoiceId?: unknown;
  status?: string | null;
  currency?: string | null;
  allocatedAmount?: number | null;
  amount?: number | null;
  orderId?: unknown;
}

export function isExcludedPayment(payment: PaymentLike): boolean {
  return payment.status === "Void" || payment.status === "Refunded";
}

function hasInvoice(payment: PaymentLike): boolean {
  return (
    payment.invoiceId !== null &&
    payment.invoiceId !== undefined &&
    String(payment.invoiceId) !== ""
  );
}

/**
 * A payment counts toward invoice `collected` only when it is linked to a
 * live invoice. Payments to a void invoice are excluded entirely.
 */
export function isInvoiceCollectedPayment(
  payment: PaymentLike,
  voidInvoiceIds: ReadonlySet<string>,
): boolean {
  if (isExcludedPayment(payment)) return false;
  if (!hasInvoice(payment)) return false;
  return !voidInvoiceIds.has(String(payment.invoiceId));
}

/** A receipt with no invoice link, reported separately from `collected`. */
export function isUnallocatedReceipt(payment: PaymentLike): boolean {
  if (isExcludedPayment(payment)) return false;
  if (hasInvoice(payment)) return false;
  return unallocatedAmount(payment) > 0;
}

export function collectedAmount(payment: PaymentLike): number {
  const n = Number(payment.allocatedAmount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function unallocatedAmount(payment: PaymentLike): number {
  const n = Number(payment.amount ?? payment.allocatedAmount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function paymentCurrency(payment: PaymentLike): string {
  const c = String(payment.currency ?? "AUD").trim().toUpperCase();
  return c || "AUD";
}

/** Build the set of void invoice ids so callers share one exclusion list. */
export function voidInvoiceIdSet(
  invoices: ReadonlyArray<{ _id?: unknown; status?: string | null }>,
): Set<string> {
  return new Set(
    invoices
      .filter((invoice) => invoice.status === "Void")
      .map((invoice) => String(invoice._id)),
  );
}
