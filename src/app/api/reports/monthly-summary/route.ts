/**
 * GET /api/reports/monthly-summary — Monthly financial summary
 *
 * Monthly rows: invoiced, collected, outstanding, commission earned,
 * supplier cost. Multi-currency: grouped by currency per month.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { filterOrdersByRole } from "@/middleware/auth";
import { applyFinancialVisibility } from "@/lib/financial-visibility";
import {
  collectedAmount,
  isExcludedPayment,
  isInvoiceCollectedPayment,
  isUnallocatedReceipt,
  paymentCurrency,
  unallocatedAmount,
  voidInvoiceIdSet,
} from "@/lib/finance-classification";

function monthKey(dateStr: string | null | undefined): string {
  if (!dateStr) return "unknown";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const orderFilter: Record<string, unknown> = {};
    if (from || to) {
      orderFilter.createdAt = {};
      if (from) (orderFilter.createdAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (orderFilter.createdAt as Record<string, unknown>).$lte = new Date(to);
    }

    const [allOrders, invoices, payments] = await Promise.all([
      (await collection("orders")).find(orderFilter).toArray(),
      (await collection("invoices")).find({}).toArray(),
      (await collection("payments")).find({}).toArray(),
    ]);

    const orders = filterOrdersByRole(auth, allOrders);
    const accessibleOrderIds = new Set(orders.map((o: any) => String(o._id)));

    // Invoices and payments must be scoped to the same accessible orders;
    // otherwise a BDC sees business-wide financial aggregates.
    const scopedInvoices = invoices.filter((i: any) =>
      accessibleOrderIds.has(String(i.orderId)),
    );
    const scopedPayments = payments.filter((p: any) =>
      accessibleOrderIds.has(String(p.orderId)),
    );
    const voidInvoiceIds = voidInvoiceIdSet(scopedInvoices);

    // Per-month, per-currency aggregation.
    const map = new Map<string, Record<string, { invoiced: number; collected: number; unallocated: number; outstanding: number; supplierCost: number; commissionEarned: number }>>();

    function ensure(month: string, cur: string) {
      if (!map.has(month)) map.set(month, {});
      const m = map.get(month)!;
      if (!m[cur]) {
        m[cur] = {
          invoiced: 0,
          collected: 0,
          unallocated: 0,
          outstanding: 0,
          supplierCost: 0,
          commissionEarned: 0,
        };
      }
      return m[cur];
    }

    for (const o of orders) {
      const month = monthKey(o.createdAt);
      const cur = o.currency || "AUD";
      const e = ensure(month, cur);
      e.supplierCost += Number(o.supplierCostSnapshot ?? 0);
    }

    for (const inv of scopedInvoices) {
      if (inv.status === "Void") continue;
      const month = monthKey(inv.createdAt);
      const cur = inv.currency || "AUD";
      const e = ensure(month, cur);
      e.invoiced += Number(inv.total ?? 0);
    }

    const paidByInvoice = new Map<string, number>();
    for (const p of scopedPayments) {
      if (isExcludedPayment(p)) continue;
      if (isUnallocatedReceipt(p)) {
        // Attribute unallocated receipts to their own month/currency and keep
        // them separate from invoice collection.
        ensure(monthKey(p.date), paymentCurrency(p)).unallocated += unallocatedAmount(p);
        continue;
      }
      if (!isInvoiceCollectedPayment(p, voidInvoiceIds)) continue;
      const invId = String(p.invoiceId);
      const m = paidByInvoice.get(invId) || 0;
      paidByInvoice.set(invId, m + collectedAmount(p));
    }
    for (const inv of scopedInvoices) {
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

    // Commission earned per month. Only approved/paid records are real
    // earnings; calculated proposals and rejected records are excluded.
    const commissionRecords = await (await collection("commission_records"))
      .find({ status: { $in: ["approved", "paid"] } })
      .toArray();
    for (const rec of commissionRecords) {
      const month = `${rec.periodYear}-${String(rec.periodMonth).padStart(2, "0")}`;
      const cur = rec.commissionCurrency || "AUD";
      const e = ensure(month, cur);
      e.commissionEarned += Number(rec.commissionAmount ?? 0);
    }

    const zeroBucket = () => ({
      invoiced: 0,
      collected: 0,
      unallocated: 0,
      outstanding: 0,
      supplierCost: 0,
      commissionEarned: 0,
    });
    const rows = Array.from(map.entries()).map(([month, byCurrency]) => {
      const currencies = Object.keys(byCurrency);
      return {
        month,
        byCurrency,
        mixedCurrency: currencies.length > 1,
        totals: currencies.length === 1
          ? byCurrency[currencies[0]]
          : currencies.length === 0
            ? zeroBucket()
            : null,
      };
    }).sort((a, b) => a.month.localeCompare(b.month));

    const result = { monthlySummary: rows };
    applyFinancialVisibility(auth, result);
    return NextResponse.json(result);
  },
);
