/**
 * GET /api/reports/ageing — overdue invoices bucketed by days past due
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { filterOrdersByRole } from "@/middleware/auth";
import { applyFinancialVisibility } from "@/lib/financial-visibility";

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    const orders = await collection("orders");
    const invoices = await (await collection("invoices")).find({ status: "Overdue" }).toArray();

    // Scope invoices to orders the user can access.
    const allOrderDocs = await orders.find({}).toArray();
    const accessibleOrderIds = new Set(
      filterOrdersByRole(auth, allOrderDocs).map((o: any) => String(o._id)),
    );
    const accessibleInvoices = invoices.filter((inv: any) =>
      accessibleOrderIds.has(String(inv.orderId)),
    );

    const now = new Date();
    const buckets: Array<{
      label: string; min: number; max: number; count: number; amount: number;
      byCurrency: Record<string, { overdue: number }>;
    }> = [
      { label: "1-30 days", min: 1, max: 30, count: 0, amount: 0, byCurrency: {} },
      { label: "31-60 days", min: 31, max: 60, count: 0, amount: 0, byCurrency: {} },
      { label: "61-90 days", min: 61, max: 90, count: 0, amount: 0, byCurrency: {} },
      { label: "90+ days", min: 91, max: Infinity, count: 0, amount: 0, byCurrency: {} },
    ];
    const currenciesSeen = new Set<string>();

    for (const inv of accessibleInvoices) {
      const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      const cur = String(inv.currency || "AUD");
      currenciesSeen.add(cur);
      for (const b of buckets) {
        if (days >= b.min && days <= b.max) {
          b.count += 1;
          b.amount += Number(inv.total ?? 0);
          b.byCurrency[cur] = {
            overdue: (b.byCurrency[cur]?.overdue ?? 0) + Number(inv.total ?? 0),
          };
          break;
        }
      }
    }

    const mixedCurrency = currenciesSeen.size > 1;
    const bucketRows = buckets.map(({ min, max, ...b }) => ({
      ...b,
      amount: mixedCurrency ? null : b.amount,
    }));
    const response = {
      mixedCurrency,
      totalOverdue: mixedCurrency
        ? null
        : buckets.reduce((s: number, b: any) => s + b.amount, 0),
      buckets: bucketRows,
    };

    return NextResponse.json(applyFinancialVisibility(auth, response));
  },
);
