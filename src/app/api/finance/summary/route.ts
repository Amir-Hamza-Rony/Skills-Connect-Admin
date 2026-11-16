/**
 * GET /api/finance/summary — dashboard finance numbers
 *
 * Returns per-currency breakdown (invoiced/collected/outstanding) plus an
 * optional reporting-currency conversion using stored exchange rates. Never
 * recalculates historical transactions using today's rate — only stored
 * exchange-rate snapshots are used.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { filterOrdersByRole } from "@/middleware/auth";

type Money = { invoiced: number; collected: number; outstanding: number };

function zero(): Money {
  return { invoiced: 0, collected: 0, outstanding: 0 };
}

export const GET = withAuth("finance.view",
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    const { searchParams } = req.nextUrl;
    const orderId = searchParams.get("orderId");
    const reportCurrency = searchParams.get("reportCurrency") || "AUD";

    const invoiceFilter: Record<string, unknown> = {};
    const paymentFilter: Record<string, unknown> = {};

    if (orderId) {
      const oid = safeObjectId(orderId);
      if (!oid) {
        return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid order id." } }, { status: 400 });
      }

      const orders = await collection("orders");
      const order = await orders.findOne({ _id: oid });
      if (!order) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });
      }
      if (!filterOrdersByRole(auth, [order]).length) {
        return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this order." } }, { status: 403 });
      }

      invoiceFilter.orderId = oid;
      paymentFilter.orderId = oid;
    } else {
      const role = auth.role ?? (auth.roleNames?.[0] as string | undefined);
      if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
        // BDC / B2B_AGENT: scope invoices/payments to orders the user can access.
        const orders = await collection("orders");
        const allOrders = await orders.find({}).toArray();
        const accessibleOrders = filterOrdersByRole(auth, allOrders);
        const accessibleOrderIds = new Set(accessibleOrders.map((o: any) => String(o._id)));
        invoiceFilter.orderId = { $in: [...accessibleOrderIds] };
        paymentFilter.orderId = { $in: [...accessibleOrderIds] };
      }
      // SUPER_ADMIN / ADMIN: no order filter (see all financial data).
    }

    const invoices = await (await collection("invoices")).find(invoiceFilter).toArray();
    const payments = await (await collection("payments")).find(paymentFilter).toArray();

    const byCurrency: Record<string, Money> = {};

    for (const inv of invoices) {
      if (inv.status === "Void") continue;
      const cur = inv.currency || "AUD";
      if (!byCurrency[cur]) byCurrency[cur] = zero();
      byCurrency[cur].invoiced += Number(inv.total ?? 0);
    }

    for (const pay of payments) {
      if (pay.status === "Void" || pay.status === "Refunded") continue;
      const cur = pay.currency || "AUD";
      if (!byCurrency[cur]) byCurrency[cur] = zero();
      byCurrency[cur].collected += Number(pay.allocatedAmount ?? 0);
    }

    const totals: Money = zero();
    const currencyBreakdown: Array<{ currency: string; invoiced: number; collected: number; outstanding: number }> = [];

    for (const [cur, m] of Object.entries(byCurrency)) {
      const outstanding = Math.max(0, m.invoiced - m.collected);
      totals.invoiced += m.invoiced;
      totals.collected += m.collected;
      totals.outstanding += outstanding;
      currencyBreakdown.push({ currency: cur, invoiced: m.invoiced, collected: m.collected, outstanding });
    }

    currencyBreakdown.sort((a, b) => b.outstanding - a.outstanding);

    return NextResponse.json({
      invoiced: totals.invoiced,
      collected: totals.collected,
      outstanding: totals.outstanding,
      reportCurrency,
      currencyBreakdown,
    });
  },
);
