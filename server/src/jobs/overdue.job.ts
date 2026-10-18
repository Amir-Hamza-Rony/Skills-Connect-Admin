import { logger } from "../lib/logger.js";
import { Invoice, type InvoiceLean } from "../models/invoice.model.js";
import { Payment } from "../models/payment.model.js";
import { PaymentPlan, type PaymentPlanLean } from "../models/payment-plan.model.js";

/**
 * Overdue sweep (BACKEND-PLAN §6, "overdue cron job").
 *
 * ## The problem this exists to solve
 *
 * Invoice status was only ever recomputed when a payment was recorded, so an
 * invoice that quietly passed its due date with no further activity stayed
 * `Sent` forever — the ageing report and the dashboard both read that field, so
 * both understated what was owed. Instalment status had a matching bug: the
 * enum contains `Overdue`, but no code path ever wrote it, so every unpaid
 * instalment sat at `Pending` indefinitely.
 *
 * Time passes without anyone calling the API, so this cannot be an event-driven
 * refresh. It has to run on a timer.
 *
 * ## Why it does not use BullMQ
 *
 * The repeat mechanism needs Redis, which is optional here — a scheduled job
 * that silently stops running on a machine without Docker is worse than a plain
 * interval. `setInterval` needs nothing and degrades nowhere.
 */

export interface OverdueSweepResult {
  invoicesFlipped: number;
  instalmentsFlipped: number;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Recomputes the stored status of every non-void invoice.
 *
 * A single pass over the whole collection rather than per-order, because the
 * question is "which invoices are past due right now" — inherently global. The
 * query narrows the candidate set first so a healthy database with nothing
 * overdue costs one indexed lookup and returns.
 */
export async function refreshAllInvoiceStatuses(): Promise<number> {
  const today = startOfToday();
  const candidates = await Invoice.find({
    status: { $in: ["Sent", "Overdue"] },
  }).lean<InvoiceLean[]>();

  if (candidates.length === 0) return 0;

  const ids = candidates.map((i) => i._id);
  const payments = await Payment.find({
    invoiceId: { $in: ids },
    status: { $nin: ["Void", "Refunded"] },
  }).lean();

  const paidByInvoice = new Map<string, number>();
  for (const p of payments) {
    if (!p.invoiceId) continue;
    const key = String(p.invoiceId);
    paidByInvoice.set(key, (paidByInvoice.get(key) ?? 0) + p.allocatedAmount);
  }

  let flipped = 0;
  for (const inv of candidates) {
    const paid = paidByInvoice.get(String(inv._id)) ?? 0;

    let status: InvoiceLean["status"];
    if (paid >= inv.total) status = "Paid";
    else if (paid > 0) status = "Part Paid";
    else if (inv.dueDate < today) status = "Overdue";
    else status = "Sent";

    if (status !== inv.status) {
      await Invoice.updateOne({ _id: inv._id }, { $set: { status } });
      flipped += 1;
    }
  }
  return flipped;
}

/**
 * Flags unpaid instalments whose due date has passed.
 *
 * Only `Pending` and `Due` are considered. `Paid`, `Part Paid`, `Waived` and
 * `Cancelled` are never touched, and an overdue instalment is reset to `Pending`
 * if a plan is amended to move its due date into the future.
 */
export async function refreshOverdueInstalments(): Promise<number> {
  const today = startOfToday();
  const plans = await PaymentPlan.find({
    instalments: {
      $elemMatch: { status: { $in: ["Pending", "Due", "Overdue"] }, dueDate: { $lt: today } },
    },
  }).lean<PaymentPlanLean[]>();

  let flipped = 0;
  for (const plan of plans) {
    // One write per plan rather than one per instalment: the embedded array is a
    // single document, so there is no way to update a subset of it atomically.
    const instalments = plan.instalments.map((inst) => {
      const open = inst.status === "Pending" || inst.status === "Due" || inst.status === "Overdue";
      if (!open) return inst;
      const next = inst.dueDate < today ? "Overdue" : "Pending";
      if (next === inst.status) return inst;
      flipped += 1;
      return { ...inst, status: next };
    });

    await PaymentPlan.updateOne({ _id: plan._id }, { $set: { instalments } });
  }
  return flipped;
}

/** One pass of both sweeps. Safe to call repeatedly. */
export async function runOverdueSweep(): Promise<OverdueSweepResult> {
  const [invoicesFlipped, instalmentsFlipped] = await Promise.all([
    refreshAllInvoiceStatuses(),
    refreshOverdueInstalments(),
  ]);

  if (invoicesFlipped > 0 || instalmentsFlipped > 0) {
    logger.info({ invoicesFlipped, instalmentsFlipped }, "Overdue sweep updated finance records");
  }
  return { invoicesFlipped, instalmentsFlipped };
}

/**
 * Starts the sweep on an interval.
 *
 * `unref()` so the timer never holds the process open on shutdown. The first
 * run is immediate-ish rather than a full interval later, so a freshly started
 * server does not report stale overdue figures for the first cycle.
 *
 * Returns a stop function. Called from `server.ts`; a no-op in tests.
 */
export function startOverdueSweep(intervalMinutes = 60): () => void {
  const ms = Math.max(1, intervalMinutes) * 60 * 1000;

  const tick = (): void => {
    void runOverdueSweep().catch((err: unknown) => {
      // A failed sweep must not take the API down; the next tick retries.
      logger.error({ err }, "Overdue sweep failed");
    });
  };

  // A short initial delay lets the server finish booting before the first query.
  const initial = setTimeout(tick, 10_000);
  const timer = setInterval(tick, ms);
  initial.unref();
  timer.unref();

  logger.info({ intervalMinutes }, "Overdue sweep scheduled");

  return () => {
    clearTimeout(initial);
    clearInterval(timer);
  };
}