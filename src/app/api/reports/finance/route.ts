/**
 * GET /api/reports/finance — headline finance numbers
 *
 * Collection definitions (shared with /finance/summary and /reports/clients):
 *   collected   — payments allocated to a live invoice.
 *   unallocated — receipts with no invoice link, exposed separately.
 * Payments to a void invoice are excluded from both.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
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

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    const { searchParams } = req.nextUrl;
    const filter: Record<string, unknown> = {};
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from || to) {
      filter.createdAt = {};
      if (from) (filter.createdAt as Record<string, Date>).$gte = new Date(from);
      if (to) (filter.createdAt as Record<string, Date>).$lte = new Date(to);
    }

    const [allOrders, allInvoices, allPayments] = await Promise.all([
      (await collection("orders")).find(filter).toArray(),
      (await collection("invoices")).find(filter).toArray(),
      (await collection("payments")).find(filter).toArray(),
    ]);

    const orders = filterOrdersByRole(auth, allOrders);
    const accessibleOrderIds = new Set(orders.map((o: any) => String(o._id)));

    // Invoices and payments must be scoped to the same orders as the rest of
    // the report. Without this, a BDC sees business-wide finance aggregates.
    const scopedInvoices = allInvoices.filter((i: any) =>
      accessibleOrderIds.has(String(i.orderId)),
    );
    const scopedPayments = allPayments.filter((p: any) =>
      accessibleOrderIds.has(String(p.orderId)),
    );
    const voidInvoiceIds = voidInvoiceIdSet(scopedInvoices);

    const newBucket = () => ({
      invoiced: 0,
      collected: 0,
      unallocated: 0,
      outstanding: 0,
      overdueAmount: 0,
      pipelineValue: 0,
    });
    const byCurrency: Record<string, ReturnType<typeof newBucket>> = {};
    const bucketFor = (currency: string) => {
      const cur = currency || "AUD";
      if (!byCurrency[cur]) byCurrency[cur] = newBucket();
      return byCurrency[cur];
    };

    const paidByInvoice = new Map<string, number>();
    for (const p of scopedPayments) {
      if (isExcludedPayment(p)) continue;
      // Receipts not linked to an invoice are cash received but not invoice
      // collection; expose them distinctly rather than in `collected`.
      if (isUnallocatedReceipt(p)) {
        bucketFor(paymentCurrency(p)).unallocated += unallocatedAmount(p);
        continue;
      }
      if (!isInvoiceCollectedPayment(p, voidInvoiceIds)) continue;
      const invoiceId = String(p.invoiceId);
      paidByInvoice.set(
        invoiceId,
        (paidByInvoice.get(invoiceId) ?? 0) + collectedAmount(p),
      );
      bucketFor(paymentCurrency(p)).collected += collectedAmount(p);
    }

    let overdueCount = 0;
    for (const i of scopedInvoices) {
      if (i.status === "Void") continue;
      const cur = String(i.currency || "AUD");
      const total = Number(i.total ?? 0);
      const paid = paidByInvoice.get(String(i._id)) ?? 0;
      const outstanding = Math.max(0, total - paid);
      const bucket = bucketFor(cur);
      bucket.invoiced += total;
      bucket.outstanding += outstanding;
      if (i.status === "Overdue") {
        overdueCount += 1;
        bucket.overdueAmount += outstanding;
      }
    }
    for (const o of orders) {
      bucketFor(String((o as any).currency || "AUD")).pipelineValue += Number((o as any).sellingPrice ?? 0);
    }

    const currencies = Object.keys(byCurrency);
    const mixedCurrency = currencies.length > 1;
    const totalsFor = (field: keyof ReturnType<typeof newBucket>) =>
      currencies.length === 1 ? byCurrency[currencies[0]][field] : 0;

    const result = {
      orders: orders.length,
      clients: new Set(orders.map((o: any) => String(o.clientId))).size,
      invoiced: mixedCurrency ? null : totalsFor("invoiced"),
      collected: mixedCurrency ? null : totalsFor("collected"),
      unallocated: mixedCurrency ? null : totalsFor("unallocated"),
      outstanding: mixedCurrency ? null : totalsFor("outstanding"),
      overdueAmount: mixedCurrency ? null : totalsFor("overdueAmount"),
      overdueCount,
      pipelineValue: mixedCurrency ? null : totalsFor("pipelineValue"),
      mixedCurrency,
      byCurrency,
    };
    // Security hotfix: pipelineValue is price-derived and revenue aggregates
    // are hidden from B2B_AGENT; order/client counts remain visible.
    applyFinancialVisibility(auth, result);
    return NextResponse.json(result);
  },
);
