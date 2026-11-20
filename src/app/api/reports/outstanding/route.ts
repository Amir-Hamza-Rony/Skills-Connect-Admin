/**
 * GET /api/reports/outstanding — Outstanding receivables report
 *
 * Per-customer outstanding invoice balance with ageing buckets
 * (1-30, 31-60, 61-90, 90+ days past due). Multi-currency aware.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { filterOrdersByRole } from "@/middleware/auth";
import { applyFinancialVisibility } from "@/lib/financial-visibility";

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const clientId = searchParams.get("clientId");
    const currency = searchParams.get("currency");

    // Include Paid invoices: a refunded payment leaves the invoice status
    // "Paid" while a real balance remains. Net balances are computed below,
    // so fully paid invoices are skipped naturally. Void is always excluded.
    const invoiceFilter: Record<string, unknown> = { status: { $ne: "Void" } };
    if (from || to) {
      invoiceFilter.createdAt = {};
      if (from) (invoiceFilter.createdAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (invoiceFilter.createdAt as Record<string, unknown>).$lte = new Date(to);
    }
    if (currency) invoiceFilter.currency = currency;

    // Scope invoices to orders the user can access (only for non-admin roles).
    const role = auth.role ?? (auth.roleNames?.[0] as string | undefined);
    if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
      const orders = await collection("orders");
      const allOrderDocs = await orders.find({}).toArray();
      const accessibleOrderIds = new Set(
        filterOrdersByRole(auth, allOrderDocs).map((o: any) => String(o._id)),
      );
      invoiceFilter.orderId = { $in: [...accessibleOrderIds] };
    }

    const [invoices, clients, allOrderDocs] = await Promise.all([
      (await collection("invoices")).find(invoiceFilter).toArray(),
      (await collection("clients")).find({}).toArray(),
      (await collection("orders")).find({}).toArray(),
    ]);

    const clientMap = new Map(clients.map((c: any) => [String(c._id), c.legalName]));
    const orderMap = new Map(allOrderDocs.map((o: any) => [String(o._id), String(o.clientId)]));

    // Outstanding per invoice.
    const payments = await (await collection("payments")).find({}).toArray();
    const paidByInvoice = new Map<string, number>();
    for (const p of payments) {
      if (p.status === "Void" || p.status === "Refunded") continue;
      const invId = String(p.invoiceId);
      if (!invId) continue;
      const m = paidByInvoice.get(invId) || 0;
      paidByInvoice.set(invId, m + Number(p.allocatedAmount ?? 0));
    }

    const now = new Date();
    const buckets = [
      { label: "Current", min: 0, max: 0, count: 0, amount: 0 },
      { label: "1-30 days", min: 1, max: 30, count: 0, amount: 0 },
      { label: "31-60 days", min: 31, max: 60, count: 0, amount: 0 },
      { label: "61-90 days", min: 61, max: 90, count: 0, amount: 0 },
      { label: "90+ days", min: 91, max: Infinity, count: 0, amount: 0 },
    ];

    // Per-customer, per-currency aggregation.
    const customerMap = new Map<string, { name: string; byCurrency: Record<string, { outstanding: number; overdue: number }> }>();
    const currenciesSeen = new Set<string>();

    for (const inv of invoices) {
      const orderClientId = orderMap.get(String(inv.orderId));
      if (!orderClientId) continue;
      const clientObj = clients.find((c: any) => String(c._id) === orderClientId);
      const clientName = clientObj ? clientObj.legalName : "Unknown";
      const cur = inv.currency || "AUD";
      currenciesSeen.add(cur);
      const paid = paidByInvoice.get(String(inv._id)) || 0;
      const outstanding = Math.max(0, Number(inv.total ?? 0) - paid);
      if (outstanding <= 0) continue;

      let entry = customerMap.get(orderClientId as string) as { name: string; byCurrency: Record<string, { outstanding: number; overdue: number }> } | undefined;
      if (!entry) {
        entry = { name: clientName, byCurrency: {} };
        customerMap.set(orderClientId as string, entry);
      }
      if (!entry!.byCurrency[cur]) entry!.byCurrency[cur] = { outstanding: 0, overdue: 0 };
      entry!.byCurrency[cur].outstanding += outstanding;

      // Ageing.
      const due = inv.dueDate ? new Date(inv.dueDate) : null;
      const daysPastDue = due ? Math.floor((now.getTime() - due.getTime()) / 86400000) : 0;
      const isOverdue = daysPastDue > 0;
      if (isOverdue) {
        entry.byCurrency[cur].overdue += outstanding;
        for (const b of buckets) {
          if (daysPastDue >= b.min && daysPastDue <= b.max) {
            b.count += 1;
            b.amount += outstanding;
            break;
          }
        }
      } else {
        buckets[0].count += 1;
        buckets[0].amount += outstanding;
      }
    }

    const mixedCurrency = currenciesSeen.size > 1;
    const rows = Array.from(customerMap.entries()).map(([id, c]) => {
      const customerCurrencies = Object.keys(c.byCurrency);
      const customerMixed = customerCurrencies.length > 1;
      return {
        clientId: id,
        clientName: c.name,
        byCurrency: c.byCurrency,
        mixedCurrency: customerMixed,
        totalOutstanding: customerMixed
          ? null
          : customerCurrencies.length === 0
            ? 0
            : c.byCurrency[customerCurrencies[0]].outstanding,
        totalOverdue: customerMixed
          ? null
          : customerCurrencies.length === 0
            ? 0
            : c.byCurrency[customerCurrencies[0]].overdue,
      };
    });

    // Cross-currency bucket amounts are unavailable: expose per-currency
    // buckets instead of silently adding different currencies together.
    const bucketRows = buckets.map((b) => ({
      label: b.label,
      count: b.count,
      amount: mixedCurrency ? null : b.amount,
    }));

    const response = {
      customers: rows,
      buckets: bucketRows,
      mixedCurrency,
      totalOutstanding: mixedCurrency ? null : buckets.reduce((s, b) => s + b.amount, 0),
      totalOverdue: mixedCurrency ? null : buckets.slice(1).reduce((s, b) => s + b.amount, 0),
    };

    return NextResponse.json(applyFinancialVisibility(auth, response));
  },
);
