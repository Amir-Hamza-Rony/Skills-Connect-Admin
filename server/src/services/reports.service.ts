import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { Agent } from "../models/agent.model.js";
import { Certificate } from "../models/certificate.model.js";
import { Document } from "../models/document.model.js";
import { Invoice, type InvoiceLean } from "../models/invoice.model.js";
import { Order, type OrderLean } from "../models/order.model.js";
import { Payment, type PaymentLean } from "../models/payment.model.js";
import { Qualification } from "../models/qualification.model.js";
import { Rto } from "../models/rto.model.js";

/**
 * Report aggregations (BACKEND-PLAN B6).
 *
 * ## Why this moved server-side
 *
 * The reports page used to pull every order, client, qualification, agent and
 * invoice and group them in the browser. That meant the numbers on screen were
 * computed from a different code path than everything else — so a report could
 * disagree with the dashboard and neither could be proven wrong. B6's criterion
 * is "dashboard numbers equal DB aggregations", which requires one
 * implementation, not two.
 *
 * ## Scope, not volume
 *
 * These pipelines are deliberately simple. The dataset is hundreds of orders,
 * not millions, and a report that takes 200ms is fine. The point is that the
 * number is *derived once* and reused, not that it is fast.
 */

/**
 * The filters every report accepts (UAT criterion 12: "filter reports by
 * agent/RTO/qualification/stage").
 *
 * `stage` is an order status. `from`/`to` bound order creation.
 */
export interface ReportFilter {
  salesAgentId?: string;
  sourceAgentId?: string;
  rtoId?: string;
  qualificationId?: string;
  stage?: OrderLean["status"];
  from?: string;
  to?: string;
}

/** Converts the filter into a Mongo filter on `orders`. Throws on bad ids. */
function orderFilter(filter: ReportFilter): Record<string, unknown> {
  const q: Record<string, unknown> = {};

  for (const key of ["salesAgentId", "sourceAgentId", "rtoId", "qualificationId"] as const) {
    const value = filter[key];
    if (!value) continue;
    if (!Types.ObjectId.isValid(value)) {
      throw AppError.badRequest("INVALID_ID", `Invalid ${key}.`);
    }
    q[key] = new Types.ObjectId(value);
  }

  if (filter.stage) q.status = filter.stage;

  const createdAt: Record<string, Date> = {};
  if (filter.from) {
    const from = new Date(`${filter.from}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime())) throw AppError.badRequest("INVALID_DATE", "Invalid 'from' date.");
    createdAt.$gte = from;
  }
  if (filter.to) {
    const to = new Date(`${filter.to}T00:00:00.000Z`);
    if (Number.isNaN(to.getTime())) throw AppError.badRequest("INVALID_DATE", "Invalid 'to' date.");
    createdAt.$lte = to;
  }
  if (Object.keys(createdAt).length > 0) q.createdAt = createdAt;

  return q;
}

function toISODate(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export interface ReportContext {
  orders: OrderLean[];
  qualifications: Map<string, { code: string; title: string }>;
  agents: Map<string, string>;
  rtos: Map<string, string>;
  invoices: InvoiceLean[];
  payments: PaymentLean[];
}

/**
 * Loads everything the reports need in four queries rather than one per report.
 *
 * Each report is a pure function over this context, so a page that shows three
 * of them pays for the data once.
 */
export async function buildReportContext(filter: ReportFilter): Promise<ReportContext> {
  const orders = await Order.find(orderFilter(filter)).lean<OrderLean[]>();

  const [qualifications, agents, rtos] = await Promise.all([
    Qualification.find().lean(),
    Agent.find().lean(),
    Rto.find().lean(),
  ]);

  const qualMap = new Map(qualifications.map((q) => [String(q._id), { code: q.code, title: q.title }]));
  const agentMap = new Map(agents.map((a) => [String(a._id), a.name]));
  const rtoMap = new Map(rtos.map((r) => [String(r._id), r.tradingName || r.legalName]));

  const orderIds = orders.map((o) => o._id);
  const [invoices, payments] = await Promise.all([
    Invoice.find({ orderId: { $in: orderIds } }).lean<InvoiceLean[]>(),
    Payment.find({ orderId: { $in: orderIds } }).lean<PaymentLean[]>(),
  ]);

  return { orders, qualifications: qualMap, agents: agentMap, rtos: rtoMap, invoices, payments };
}

/** `grossMargin` — the same formula the frontend used, now the only one. */
export function grossMargin(order: Pick<OrderLean, "sellingPrice" | "supplierCostSnapshot" | "otherCost">): number {
  return order.sellingPrice - order.supplierCostSnapshot - (order.otherCost ?? 0);
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

/** `GET /reports/finance` — the headline numbers. */
export function financeReport(ctx: ReportContext) {
  const liveInvoices = ctx.invoices.filter((i) => i.status !== "Void");
  const invoiced = liveInvoices.reduce((sum, i) => sum + i.total, 0);

  // A payment counts against the invoices it is linked to; refunds do not add.
  const collected = ctx.payments
    .filter((p) => p.status !== "Void" && p.status !== "Refunded")
    .reduce((sum, p) => sum + p.allocatedAmount, 0);

  const overdue = ctx.invoices.filter((i) => i.status === "Overdue");

  return {
    orders: ctx.orders.length,
    clients: new Set(ctx.orders.map((o) => String(o.clientId))).size,
    invoiced,
    collected,
    outstanding: Math.max(0, invoiced - collected),
    overdueAmount: overdue.reduce((sum, i) => sum + i.total, 0),
    overdueCount: overdue.length,
    pipelineValue: ctx.orders.reduce((sum, o) => sum + o.sellingPrice, 0),
  };
}

/** `GET /reports/revenue` — revenue and order count by qualification and agent. */
export function revenueReport(ctx: ReportContext) {
  const byQualification = new Map<string, { orders: number; revenue: number }>();
  const byAgent = new Map<string, { orders: number; revenue: number }>();

  for (const o of ctx.orders) {
    const qualKey = ctx.qualifications.get(String(o.qualificationId))?.code ?? String(o.qualificationId);
    const qual = byQualification.get(qualKey) ?? { orders: 0, revenue: 0 };
    qual.orders += 1;
    qual.revenue += o.sellingPrice;
    byQualification.set(qualKey, qual);

    const agentKey = ctx.agents.get(String(o.salesAgentId)) ?? String(o.salesAgentId);
    const agent = byAgent.get(agentKey) ?? { orders: 0, revenue: 0 };
    agent.orders += 1;
    agent.revenue += o.sellingPrice;
    byAgent.set(agentKey, agent);
  }

  return {
    byQualification: [...byQualification.entries()].map(([name, v]) => ({ name, ...v })),
    byAgent: [...byAgent.entries()].map(([name, v]) => ({ name, ...v })),
  };
}

/** `GET /reports/margin` — where the profit actually is. */
export function marginReport(ctx: ReportContext) {
  const byQualification = new Map<string, { orders: number; revenue: number; cost: number; margin: number }>();
  const totals = { orders: 0, revenue: 0, cost: 0, margin: 0 };

  for (const o of ctx.orders) {
    const name = ctx.qualifications.get(String(o.qualificationId))?.code ?? String(o.qualificationId);
    const row = byQualification.get(name) ?? { orders: 0, revenue: 0, cost: 0, margin: 0 };
    const margin = grossMargin(o);

    row.orders += 1;
    row.revenue += o.sellingPrice;
    row.cost += o.supplierCostSnapshot + (o.otherCost ?? 0);
    row.margin += margin;
    byQualification.set(name, row);

    totals.orders += 1;
    totals.revenue += o.sellingPrice;
    totals.cost += o.supplierCostSnapshot + (o.otherCost ?? 0);
    totals.margin += margin;
  }

  return {
    totals,
    byQualification: [...byQualification.entries()]
      .map(([name, v]) => ({ name, ...v, percent: v.revenue > 0 ? Math.round((v.margin / v.revenue) * 100) : 0 }))
      .sort((a, b) => b.margin - a.margin),
  };
}

/** `GET /reports/funnel` — orders by workflow stage, plus conversion. */
export function funnelReport(ctx: ReportContext) {
  const byStage = new Map<string, number>();
  for (const o of ctx.orders) byStage.set(o.status, (byStage.get(o.status) ?? 0) + 1);

  const total = ctx.orders.length;
  const completed = byStage.get("Completed") ?? 0;

  return {
    total,
    completed,
    conversionPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    byStage: [...byStage.entries()].map(([stage, count]) => ({
      stage,
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
    })),
  };
}

/**
 * `GET /reports/ageing` — overdue invoices bucketed by how long they have been
 * overdue.
 *
 * The reports page previously said this "arrives with the backend"; this is it.
 * Buckets are 1–30, 31–60, 61–90 and 90+ days past due.
 */
export function ageingReport(ctx: ReportContext, now = new Date()) {
  // Filtered with `filter` rather than `find` so the match is narrowed by the
  // loop itself — indexing a bucket would need `!` under
  // `noUncheckedIndexedAccess`, and an `!` here would hide a real gap in the
  // bucket ranges.
  const buckets = [
    { label: "1-30 days", min: 1, max: 30, count: 0, amount: 0 },
    { label: "31-60 days", min: 31, max: 60, count: 0, amount: 0 },
    { label: "61-90 days", min: 61, max: 90, count: 0, amount: 0 },
    { label: "90+ days", min: 91, max: Number.POSITIVE_INFINITY, count: 0, amount: 0 },
  ];

  for (const inv of ctx.invoices) {
    if (inv.status !== "Overdue") continue;
    const days = Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000);
    for (const bucket of buckets.filter((b) => days >= b.min && days <= b.max)) {
      bucket.count += 1;
      bucket.amount += inv.total;
    }
  }

  const total = buckets.reduce((sum, b) => sum + b.amount, 0);

  return {
    totalOverdue: total,
    buckets,
  };
}

/** `GET /reports/collections` — invoiced vs collected, by month. */
export function collectionsReport(ctx: ReportContext) {
  const byMonth = new Map<string, { invoiced: number; collected: number; orders: number }>();

  for (const inv of ctx.invoices) {
    if (inv.status === "Void") continue;
    const key = toISODate(inv.createdAt).slice(0, 7);
    const row = byMonth.get(key) ?? { invoiced: 0, collected: 0, orders: 0 };
    row.invoiced += inv.total;
    byMonth.set(key, row);
  }

  for (const pay of ctx.payments) {
    if (pay.status === "Void" || pay.status === "Refunded") continue;
    const key = toISODate(pay.date).slice(0, 7);
    const row = byMonth.get(key) ?? { invoiced: 0, collected: 0, orders: 0 };
    row.collected += pay.allocatedAmount;
    byMonth.set(key, row);
  }

  for (const o of ctx.orders) {
    const key = toISODate(o.createdAt).slice(0, 7);
    const row = byMonth.get(key) ?? { invoiced: 0, collected: 0, orders: 0 };
    row.orders += 1;
    byMonth.set(key, row);
  }

  return {
    months: [...byMonth.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/**
 * RTO turnaround — days from order creation to completion, by RTO.
 *
 * The reports page flags this as backend work; it needs the RTO name, which
 * only the server can join.
 */
export function rtoTurnaroundReport(filter: ReportFilter) {
  return computeRtoTurnaround(filter);
}

async function computeRtoTurnaround(filter: ReportFilter) {
  const { Rto } = await import("../models/rto.model.js");
  const rtos = await Rto.find().lean();
  const rtoName = new Map(rtos.map((r) => [String(r._id), r.legalName]));

  const orders = await Order.find({ ...orderFilter(filter), completedAt: { $ne: null } }).lean<OrderLean[]>();

  const byRto = new Map<string, { completed: number; totalDays: number }>();
  for (const o of orders) {
    const name = rtoName.get(String(o.rtoId)) ?? String(o.rtoId);
    const row = byRto.get(name) ?? { completed: 0, totalDays: 0 };
    row.completed += 1;
    row.totalDays += Math.round((o.completedAt!.getTime() - o.createdAt.getTime()) / 86_400_000);
    byRto.set(name, row);
  }

  const rows = [...byRto.entries()].map(([name, v]) => ({
    name,
    completed: v.completed,
    averageDays: v.completed > 0 ? Math.round((v.totalDays / v.completed) * 10) / 10 : 0,
  }));

  const totalCompleted = rows.reduce((sum, r) => sum + r.completed, 0);

  return {
    totalCompleted,
    averageDays: totalCompleted > 0
      ? Math.round((rows.reduce((sum, r) => sum + r.averageDays * r.completed, 0) / totalCompleted) * 10) / 10
      : 0,
    byRto: rows,
  };
}

/** `GET /reports/revenue-by-month` — invoiced vs collected, grouped by month. */
export function revenueByMonthReport(ctx: ReportContext) {
  const byMonth = new Map<string, { invoiced: number; collected: number; orders: number }>();

  for (const inv of ctx.invoices) {
    if (inv.status === "Void") continue;
    const key = toISODate(inv.createdAt).slice(0, 7);
    const row = byMonth.get(key) ?? { invoiced: 0, collected: 0, orders: 0 };
    row.invoiced += inv.total;
    byMonth.set(key, row);
  }

  for (const pay of ctx.payments) {
    if (pay.status === "Void" || pay.status === "Refunded") continue;
    const key = toISODate(pay.date).slice(0, 7);
    const row = byMonth.get(key) ?? { invoiced: 0, collected: 0, orders: 0 };
    row.collected += pay.allocatedAmount;
    byMonth.set(key, row);
  }

  for (const o of ctx.orders) {
    const key = toISODate(o.createdAt).slice(0, 7);
    const row = byMonth.get(key) ?? { invoiced: 0, collected: 0, orders: 0 };
    row.orders += 1;
    byMonth.set(key, row);
  }

  return {
    months: [...byMonth.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/** `GET /reports/revenue-by-supplier` — revenue by source agent and by RTO. */
export function revenueBySupplierReport(ctx: ReportContext) {
  const bySourceAgent = new Map<string, { orders: number; revenue: number }>();
  const byRto = new Map<string, { orders: number; revenue: number }>();

  for (const o of ctx.orders) {
    const sourceKey = ctx.agents.get(String(o.sourceAgentId)) ?? String(o.sourceAgentId);
    const sRow = bySourceAgent.get(sourceKey) ?? { orders: 0, revenue: 0 };
    sRow.orders += 1;
    sRow.revenue += o.sellingPrice;
    bySourceAgent.set(sourceKey, sRow);

    const rtoKey = ctx.rtos.get(String(o.rtoId)) ?? String(o.rtoId);
    const rRow = byRto.get(rtoKey) ?? { orders: 0, revenue: 0 };
    rRow.orders += 1;
    rRow.revenue += o.sellingPrice;
    byRto.set(rtoKey, rRow);
  }

  return {
    bySourceAgent: [...bySourceAgent.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
    byRto: [...byRto.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
  };
}

/** `GET /reports/document-completion` — document completion & rejection rates. */
export async function documentCompletionReport(filter: ReportFilter) {
  const orderFilterQ = orderFilter(filter);
  const orderIds = (
    await Order.find(orderFilterQ, { _id: 1 }).lean<{ _id: Types.ObjectId }[]>()
  ).map((o) => o._id);

  const docs = await Document.find({ orderId: { $in: orderIds } }).lean();

  const byType = new Map<string, { total: number; approved: number; rejected: number }>();
  for (const d of docs) {
    const row = byType.get(d.type) ?? { total: 0, approved: 0, rejected: 0 };
    row.total += 1;
    if (d.status === "Approved") row.approved += 1;
    if (d.status === "Rejected") row.rejected += 1;
    byType.set(d.type, row);
  }

  return {
    byType: [...byType.entries()]
      .map(([type, v]) => ({
        type,
        total: v.total,
        approved: v.approved,
        rejected: v.rejected,
        approvalRate: v.total > 0 ? Math.round((v.approved / v.total) * 100) : 0,
        rejectionRate: v.total > 0 ? Math.round((v.rejected / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total),
  };
}

/** `GET /reports/certificate-completion-time` — days from order creation to certificate delivered. */
export async function certificateCompletionTimeReport(filter: ReportFilter) {
  const orderFilterQ = orderFilter(filter);
  const orders = await Order.find({
    ...orderFilterQ,
    certificateStatus: "Delivered to Client",
  }).lean<OrderLean[]>();

  const certs = await Certificate.find({
    orderId: { $in: orders.map((o) => o._id) },
  }).lean();

  const certMap = new Map(certs.map((c) => [String(c.orderId), c]));

  const durations: number[] = [];
  for (const o of orders) {
    const cert = certMap.get(String(o._id));
    if (cert?.deliveredToClientAt) {
      durations.push(Math.round((cert.deliveredToClientAt.getTime() - o.createdAt.getTime()) / 86_400_000));
    }
  }

  durations.sort((a, b) => a - b);

  return {
    count: durations.length,
    averageDays: durations.length > 0 ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10 : 0,
    medianDays: durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0,
    minDays: durations.length > 0 ? durations[0] : 0,
    maxDays: durations.length > 0 ? durations[durations.length - 1] : 0,
  };
}