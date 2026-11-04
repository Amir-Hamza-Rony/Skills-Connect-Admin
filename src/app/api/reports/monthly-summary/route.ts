/**
 * GET /api/reports/monthly-summary — Monthly financial summary
 *
 * Monthly rows: invoiced, collected, outstanding, commission earned,
 * supplier cost. Multi-currency: grouped by currency per month.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";

function monthKey(dateStr: string | null | undefined): string {
  if (!dateStr) return "unknown";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const orderFilter: Record<string, unknown> = {};
    if (from || to) {
      orderFilter.createdAt = {};
      if (from) (orderFilter.createdAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (orderFilter.createdAt as Record<string, unknown>).$lte = new Date(to);
    }

    const [orders, invoices, payments] = await Promise.all([
      (await collection("orders")).find(orderFilter).toArray(),
      (await collection("invoices")).find({}).toArray(),
      (await collection("payments")).find({}).toArray(),
    ]);

    // Per-month, per-currency aggregation.
    const map = new Map<string, Record<string, { invoiced: number; collected: number; outstanding: number; supplierCost: number; commissionEarned: number }>>();

    function ensure(month: string, cur: string) {
      if (!map.has(month)) map.set(month, {});
      const m = map.get(month)!;
      if (!m[cur]) m[cur] = { invoiced: 0, collected: 0, outstanding: 0, supplierCost: 0, commissionEarned: 0 };
      return m[cur];
    }

    for (const o of orders) {
      const month = monthKey(o.createdAt);
      const cur = o.currency || "AUD";
      const e = ensure(month, cur);
      e.supplierCost += Number(o.supplierCostSnapshot ?? 0);
    }

    for (const inv of invoices) {
      if (inv.status === "Void") continue;
      const month = monthKey(inv.createdAt);
      const cur = inv.currency || "AUD";
      const e = ensure(month, cur);
      e.invoiced += Number(inv.total ?? 0);
    }

    const paidByInvoice = new Map<string, number>();
    for (const p of payments) {
      if (p.status === "Void" || p.status === "Refunded") continue;
      const invId = String(p.invoiceId);
      if (!invId) continue;
      const m = paidByInvoice.get(invId) || 0;
      paidByInvoice.set(invId, m + Number(p.allocatedAmount ?? 0));
    }
    for (const inv of invoices) {
      if (inv.status === "Void") continue;
      const paid = paidByInvoice.get(String(inv._id)) || 0;
      const month = monthKey(inv.createdAt);
      const cur = inv.currency || "AUD";
      const e = ensure(month, cur);
      e.collected += paid;
    }

    // Compute outstanding.
    for (const month of map.values()) {
      for (const e of Object.values(month)) {
        e.outstanding = Math.max(0, e.invoiced - e.collected);
      }
    }

    // Commission earned per month (from commission records).
    const commissionRecords = await (await collection("commission_records")).find({}).toArray();
    for (const rec of commissionRecords) {
      const month = `${rec.periodYear}-${String(rec.periodMonth).padStart(2, "0")}`;
      const cur = rec.commissionCurrency || "AUD";
      const e = ensure(month, cur);
      e.commissionEarned += Number(rec.commissionAmount ?? 0);
    }

    const rows = Array.from(map.entries()).map(([month, byCurrency]) => ({
      month,
      byCurrency,
      totals: {
        invoiced: Object.values(byCurrency).reduce((s, v) => s + v.invoiced, 0),
        collected: Object.values(byCurrency).reduce((s, v) => s + v.collected, 0),
        outstanding: Object.values(byCurrency).reduce((s, v) => s + v.outstanding, 0),
        supplierCost: Object.values(byCurrency).reduce((s, v) => s + v.supplierCost, 0),
        commissionEarned: Object.values(byCurrency).reduce((s, v) => s + v.commissionEarned, 0),
      },
    })).sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({ monthlySummary: rows });
  },
);
