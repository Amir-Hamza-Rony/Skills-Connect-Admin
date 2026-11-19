/**
 * GET /api/reports/dashboard — server-authorised role dashboard data.
 *
 * This is the single analytics source for the four role dashboards. Scope is
 * ALWAYS derived from the verified access token; query filters can only narrow
 * it. All five protected M0 helpers are reused unchanged. Financial values are
 * kept per currency (no simulated conversion) and are masked before
 * serialization.
 */

import { NextResponse } from "next/server";
import {
  withAuth,
  filterOrdersByRole,
  getAccessibleClientIds,
  checkClientAccess,
  type AuthedRequest,
} from "@/middleware/auth";
import { collection } from "@/lib/db";
import { resolvePrimaryRole } from "@/lib/permissions";
import {
  applyFinancialVisibility,
  canViewAllFinancials,
  canViewPriceAndRevenue,
} from "@/lib/financial-visibility";
import {
  collectedAmount,
  isInvoiceCollectedPayment,
  isUnallocatedReceipt,
  paymentCurrency,
  unallocatedAmount,
  voidInvoiceIdSet,
} from "@/lib/finance-classification";

type Kpi = {
  id: string;
  label: string;
  caption: string;
  value: number | string | null;
  unit?: "count" | "money" | "percent";
  currency?: string;
};

type CurrencyTotals = {
  currency: string;
  invoiced: number;
  collected: number;
  unallocated: number;
  outstanding: number;
  overdue: number;
};

const TERMINAL_CANCELLED = new Set(["Cancelled", "Refunded"]);
const DOCUMENT_MISSING = new Set(["Requested", "Not Received"]);

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function periodStart(period: string | null): Date | null {
  if (!period) return null;
  const now = new Date();
  const start = new Date(now);
  if (period === "week") start.setDate(now.getDate() - 7);
  else if (period === "month") start.setMonth(now.getMonth() - 1);
  else if (period === "quarter") start.setMonth(now.getMonth() - 3);
  else if (period === "year") start.setFullYear(now.getFullYear() - 1);
  else return null;
  return start;
}

function monthKey(value: unknown): string {
  const d = asDate(value);
  if (!d) return "unknown";
  return d.toISOString().slice(0, 7);
}

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    const { searchParams } = req.nextUrl;

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const from = asDate(fromParam) ?? periodStart(searchParams.get("period"));
    const to = asDate(toParam);
    const statusFilter = searchParams.get("status");
    const agentFilter = searchParams.get("agentId");
    const view = searchParams.get("view") ?? "overview";

    if ((fromParam && !asDate(fromParam)) || (toParam && !asDate(toParam))) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid date filter." } },
        { status: 400 },
      );
    }

    const isAdmin = canViewAllFinancials(auth);
    const canViewFinance = isAdmin && auth.permissions.includes("finance.view");
    const canViewPrice = canViewPriceAndRevenue(auth);

    const [
      allOrders,
      allClients,
      allDocuments,
      allTasks,
      allRtoProcessing,
      allCertificates,
      allDeliveries,
      allQualifications,
      allRtos,
      allAgents,
    ] = await Promise.all([
      (await collection("orders")).find({}).toArray(),
      (await collection("clients")).find({}).toArray(),
      (await collection("documents")).find({}).toArray(),
      (await collection("workflow-tasks")).find({}).toArray(),
      (await collection("rto-processing")).find({}).toArray(),
      (await collection("certificates")).find({}).toArray(),
      (await collection("certificate_deliveries")).find({}).toArray(),
      (await collection("qualifications")).find({}).toArray(),
      (await collection("rtos")).find({}).toArray(),
      (await collection("agents")).find({}).toArray(),
    ]);

    // Protected M0 scoping helpers — the only source of row-level access.
    let orders = filterOrdersByRole(auth, allOrders);
    if (from) orders = orders.filter((o: any) => (asDate(o.createdAt)?.getTime() ?? 0) >= from.getTime());
    if (to) orders = orders.filter((o: any) => (asDate(o.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER) <= to.getTime());
    if (statusFilter) orders = orders.filter((o: any) => o.status === statusFilter);
    if (agentFilter && isAdmin) {
      orders = orders.filter((o: any) =>
        [o.salesAgentId, o.sourceAgentId, o.rtoContactId].some(
          (id) => id != null && String(id) === agentFilter,
        ),
      );
    }

    const orderIds = new Set(orders.map((o: any) => String(o._id)));
    const inScope = (doc: any) => !!doc && orderIds.has(String(doc.orderId));

    const docs = allDocuments.filter(inScope);
    const tasks = allTasks.filter(inScope);
    const rtoProcessing = allRtoProcessing.filter(inScope);
    const certificates = allCertificates.filter(inScope);
    const deliveries = allDeliveries.filter(inScope);

    const accessibleClientIds = await getAccessibleClientIds(auth);
    const clients = allClients.filter((c: any) =>
      checkClientAccess(auth, c, accessibleClientIds),
    );

    const qualName = new Map(allQualifications.map((q: any) => [String(q._id), q.name ?? q.code ?? String(q._id)]));
    const rtoName = new Map(allRtos.map((r: any) => [String(r._id), r.name ?? r.rtoCode ?? String(r._id)]));
    const agentName = new Map(allAgents.map((a: any) => [String(a._id), a.name ?? String(a._id)]));
    const clientName = new Map(allClients.map((c: any) => [String(c._id), c.name ?? c.companyName ?? String(c._id)]));

    /* ---------------- KPI groups ---------------- */

    const completed = orders.filter((o: any) => o.status === "Completed").length;
    const cancelled = orders.filter((o: any) => TERMINAL_CANCELLED.has(o.status)).length;
    const pending = orders.length - completed - cancelled;
    const missingDocuments = docs.filter((d: any) => DOCUMENT_MISSING.has(d.status)).length;
    const approvedDocuments = docs.filter((d: any) => d.status === "Approved").length;
    const openTasks = tasks.filter((t: any) => t.status !== "Done" && t.status !== "Completed" && t.status !== "Cancelled").length;
    const certReceived = certificates.filter((c: any) => c.fileData || c.fileBytes || c.status === "Certificate File Received").length;
    const certDelivered = deliveries.filter((d: any) => d.deliveryStatus === "delivered").length;
    const rtoSubmitted = orders.filter((o: any) =>
      ["Submitted to RTO", "RTO Acknowledged", "Under Assessment", "Approved", "Certificate Issued", "Completed"].includes(o.status),
    ).length;

    const overviewKpis: Kpi[] = [
      { id: "clients", label: "Clients", caption: "In your accessible scope", value: clients.length, unit: "count" },
      { id: "orders", label: "Orders", caption: "Certificate orders in scope", value: orders.length, unit: "count" },
      { id: "completed", label: "Completed", caption: "Status = Completed", value: completed, unit: "count" },
      { id: "pending", label: "In progress", caption: "Open, non-terminal orders", value: pending, unit: "count" },
      { id: "cancelled", label: "Closed / cancelled", caption: "Cancelled or refunded", value: cancelled, unit: "count" },
      { id: "missingDocuments", label: "Missing documents", caption: "Requested or not received", value: missingDocuments, unit: "count" },
      { id: "certProgress", label: "Certificates received", caption: "Certificate file on record", value: certReceived, unit: "count" },
      { id: "followUps", label: "Open follow-ups", caption: "Unfinished workflow tasks", value: openTasks, unit: "count" },
    ];

    const pipelineKpis: Kpi[] = [
      { id: "readySubmission", label: "Ready for submission", caption: "Awaiting source/RTO hand-off", value: orders.filter((o: any) => o.status === "Ready for Submission").length, unit: "count" },
      { id: "submittedRto", label: "Submitted to RTO", caption: "Reached an RTO stage", value: rtoSubmitted, unit: "count" },
      { id: "underAssessment", label: "Under assessment", caption: "Assessment in progress", value: orders.filter((o: any) => o.status === "Under Assessment").length, unit: "count" },
      { id: "approvedDocuments", label: "Approved documents", caption: "Reviewed and accepted", value: approvedDocuments, unit: "count" },
      { id: "certDelivered", label: "Certificates delivered", caption: "Delivery confirmed", value: certDelivered, unit: "count" },
      { id: "rtoProcessingRecords", label: "RTO records", caption: "Processing records in scope", value: rtoProcessing.length, unit: "count" },
    ];

    /* ---------------- Finance (admins only) ---------------- */

    const scopedInvoices = canViewFinance
      ? (await (await collection("invoices")).find({}).toArray()).filter(inScope)
      : [];
    const scopedPayments = canViewFinance
      ? (await (await collection("payments")).find({}).toArray()).filter(inScope)
      : [];

    const voidInvoiceIds = voidInvoiceIdSet(scopedInvoices);
    const paidByInvoice = new Map<string, number>();
    for (const p of scopedPayments) {
      if (!isInvoiceCollectedPayment(p, voidInvoiceIds)) continue;
      const key = String(p.invoiceId);
      paidByInvoice.set(key, (paidByInvoice.get(key) ?? 0) + collectedAmount(p));
    }

    const currencyMap = new Map<string, CurrencyTotals>();
    const bucket = (currency: string) => {
      const key = currency || "AUD";
      if (!currencyMap.has(key)) {
        currencyMap.set(key, {
          currency: key,
          invoiced: 0,
          collected: 0,
          unallocated: 0,
          outstanding: 0,
          overdue: 0,
        });
      }
      return currencyMap.get(key)!;
    };

    const today = Date.now();
    for (const inv of scopedInvoices) {
      if (inv.status === "Void") continue;
      const b = bucket((inv as any).currency);
      const total = Number(inv.total ?? 0);
      const paid = paidByInvoice.get(String(inv._id)) ?? 0;
      b.invoiced += total;
      b.collected += Math.min(total, paid);
      b.outstanding += Math.max(0, total - paid);
      const due = asDate(inv.dueDate);
      if (inv.status === "Overdue" || (due && due.getTime() < today && inv.status !== "Paid")) {
        b.overdue += Math.max(0, total - paid);
      }
    }
    for (const p of scopedPayments) {
      if (!isUnallocatedReceipt(p)) continue;
      bucket(paymentCurrency(p)).unallocated += unallocatedAmount(p);
    }
    const currencyTotals = Array.from(currencyMap.values())
      .map((b) => ({ ...b, outstanding: Math.max(0, b.outstanding) }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    const financeKpis: Kpi[] = currencyTotals.flatMap((b) => [
      { id: `invoiced-${b.currency}`, label: `Invoiced (${b.currency})`, caption: "Excludes void invoices", value: b.invoiced, unit: "money" as const, currency: b.currency },
      { id: `collected-${b.currency}`, label: `Collected (${b.currency})`, caption: "Allocated to invoices", value: b.collected, unit: "money" as const, currency: b.currency },
      { id: `unallocated-${b.currency}`, label: `Unallocated (${b.currency})`, caption: "Receipts not linked to an invoice", value: b.unallocated, unit: "money" as const, currency: b.currency },
      { id: `outstanding-${b.currency}`, label: `Outstanding (${b.currency})`, caption: "Invoice balance", value: b.outstanding, unit: "money" as const, currency: b.currency },
      { id: `overdue-${b.currency}`, label: `Overdue (${b.currency})`, caption: "Past due, net of payments", value: b.overdue, unit: "money" as const, currency: b.currency },
    ]);

    /* ---------------- Commission (verified records only) ---------------- */

    const commissionRecords = canViewFinance
      ? (await (await collection("commission_records")).find({ status: { $in: ["approved", "paid"] } }).toArray())
      : [];
    const commissionByCurrency = new Map<string, number>();
    const commissionByMonth = new Map<string, { month: string; currency: string; amount: number }>();
    for (const rec of commissionRecords) {
      const currency = String(rec.commissionCurrency ?? "AUD");
      const amount = Number(rec.commissionAmount ?? 0);
      commissionByCurrency.set(currency, (commissionByCurrency.get(currency) ?? 0) + amount);
      const month = `${rec.periodYear ?? ""}-${String(rec.periodMonth ?? "").padStart(2, "0")}`;
      const key = `${month}:${currency}`;
      const entry = commissionByMonth.get(key) ?? { month, currency, amount: 0 };
      entry.amount += amount;
      commissionByMonth.set(key, entry);
    }
    const commissionKpis: Kpi[] = Array.from(commissionByCurrency.entries()).map(([currency, amount]) => ({
      id: `commission-${currency}`,
      label: `Approved commission (${currency})`,
      caption: "Approved or paid records only",
      value: amount,
      unit: "money",
      currency,
    }));

    /* ---------------- Charts ---------------- */

    const ordersByMonth = new Map<string, number>();
    // Revenue is grouped by month AND currency; adding different currencies
    // together would be a false total, so each series carries its own code.
    const revenueByMonth = new Map<string, { month: string; currency: string; amount: number }>();
    const statusCount = new Map<string, number>();
    const qualificationCount = new Map<string, number>();
    const rtoStageCount = new Map<string, number>();
    const agentStats = new Map<string, { id: string; name: string; responsibility: string; orders: number; completed: number }>();

    for (const o of orders) {
      const mk = monthKey(o.createdAt);
      ordersByMonth.set(mk, (ordersByMonth.get(mk) ?? 0) + 1);
      statusCount.set(o.status, (statusCount.get(o.status) ?? 0) + 1);

      const qLabel = String(qualName.get(String(o.qualificationId)) ?? "Unspecified");
      qualificationCount.set(qLabel, (qualificationCount.get(qLabel) ?? 0) + 1);

      const rtoStage = String(o.rtoSubmissionStatus ?? "Not started");
      rtoStageCount.set(rtoStage, (rtoStageCount.get(rtoStage) ?? 0) + 1);

      if (canViewPrice && canViewFinance) {
        const currency = String(o.currency ?? "AUD");
        const key = `${mk}:${currency}`;
        const series = revenueByMonth.get(key) ?? { month: mk, currency, amount: 0 };
        series.amount += Number(o.sellingPrice ?? 0);
        revenueByMonth.set(key, series);
      }

      const responsibilities: Array<[string, any]> = [
        ["sales_closing", o.salesAgentId],
        ["certificate_source", o.sourceAgentId],
        ["rto_contact", o.rtoContactId],
      ];
      for (const [responsibility, rawId] of responsibilities) {
        if (rawId == null) continue;
        const id = String(rawId);
        const stat = agentStats.get(id) ?? {
          id,
          name: String(agentName.get(id) ?? id),
          responsibility,
          orders: 0,
          completed: 0,
        };
        stat.orders += 1;
        if (o.status === "Completed") stat.completed += 1;
        agentStats.set(id, stat);
      }
    }

    const charts = {
      ordersOverTime: Array.from(ordersByMonth.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, count]) => ({ month, count })),
      revenueOverTime: canViewPrice && canViewFinance
        ? Array.from(revenueByMonth.values())
            .sort((a, b) => `${a.month}:${a.currency}`.localeCompare(`${b.month}:${b.currency}`))
        : [],
      statusDistribution: Array.from(statusCount.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      qualificationDistribution: Array.from(qualificationCount.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      rtoProgress: Array.from(rtoStageCount.entries())
        .map(([stage, count]) => ({ stage, count }))
        .sort((a, b) => b.count - a.count),
      agentPerformance: Array.from(agentStats.values())
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 12),
      commissionTrend: Array.from(commissionByMonth.values())
        .sort((a, b) => a.month.localeCompare(b.month)),
    };

    /* ---------------- Tables ---------------- */

    const docsByClient = new Map<string, number>();
    for (const o of orders) {
      const cId = String(o.clientId);
      docsByClient.set(cId, docsByClient.get(cId) ?? 0);
    }
    for (const d of docs) {
      if (!DOCUMENT_MISSING.has(d.status)) continue;
      const order: any = orders.find((o: any) => String(o._id) === String(d.orderId));
      if (!order) continue;
      const cId = String(order.clientId);
      docsByClient.set(cId, (docsByClient.get(cId) ?? 0) + 1);
    }

    const tableClients = clients.slice(0, 100).map((c: any) => ({
      id: String(c._id),
      name: c.name ?? c.companyName ?? String(c._id),
      email: c.email ?? null,
      phone: c.phone ?? null,
      status: c.status ?? "Unknown",
      orderCount: orders.filter((o: any) => String(o.clientId) === String(c._id)).length,
      missingDocuments: docsByClient.get(String(c._id)) ?? 0,
      qualification: c.qualificationId ? String(qualName.get(String(c.qualificationId)) ?? "") : null,
    }));

    const tableOrders = orders.slice(0, 100).map((o: any) => {
      const row: Record<string, unknown> = {
        id: String(o._id),
        client: String(clientName.get(String(o.clientId)) ?? "Unknown"),
        qualification: String(qualName.get(String(o.qualificationId)) ?? "Unspecified"),
        rto: String(rtoName.get(String(o.rtoId)) ?? "Unspecified"),
        status: o.status,
        evidenceStatus: o.evidenceStatus ?? null,
        rtoSubmissionStatus: o.rtoSubmissionStatus ?? null,
        certificateStatus: o.certificateStatus ?? null,
        createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
      };
      if (canViewPrice) {
        row.currency = o.currency ?? null;
        row.amount = Number(o.sellingPrice ?? 0);
      }
      return row;
    });

    const tableInvoices = canViewFinance
      ? scopedInvoices.slice(0, 100).map((i: any) => ({
          id: String(i._id),
          invoiceNumber: i.invoiceNumber ?? String(i._id),
          client: String(clientName.get(String((orders.find((o: any) => String(o._id) === String(i.orderId)) as any)?.clientId)) ?? "Unknown"),
          status: i.status,
          dueDate: i.dueDate ?? null,
          currency: i.currency ?? "AUD",
          total: Number(i.total ?? 0),
        }))
      : [];

    const kpis = {
      overview: overviewKpis,
      pipeline: pipelineKpis,
      finance: financeKpis,
      commission: commissionKpis,
    };

    const payload = {
      role: resolvePrimaryRole(auth) ?? "UNKNOWN",
      generatedAt: new Date().toISOString(),
      view,
      filters: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, status: statusFilter, agentId: agentFilter && isAdmin ? agentFilter : null },
      scope: {
        scoped: !isAdmin,
        clients: clients.length,
        orders: orders.length,
      },
      availability: {
        finance: {
          available: canViewFinance,
          reason: canViewFinance ? undefined : "Financial data requires finance.view permission.",
        },
        commission: {
          available: canViewFinance && commissionRecords.length > 0,
          reason: canViewFinance
            ? commissionRecords.length === 0
              ? "No approved or paid commission records are available."
              : undefined
            : "Commission data requires administrative permission.",
        },
        charts: {
          available: orders.length > 0,
          reason: orders.length === 0 ? "No orders match the selected filters." : undefined,
        },
      },
      currencyTotals,
      kpis,
      charts,
      tables: {
        clients: tableClients,
        orders: tableOrders,
        invoices: tableInvoices,
        tasks: tasks.slice(0, 50).map((t: any) => ({
          id: String(t._id),
          title: t.title ?? t.name ?? "Task",
          status: t.status,
          dueDate: t.dueDate ?? null,
          orderId: t.orderId ? String(t.orderId) : null,
        })),
      },
    };

    // Defence in depth: strip any financial field that slipped through.
    return NextResponse.json(applyFinancialVisibility(auth, payload));
  },
);
