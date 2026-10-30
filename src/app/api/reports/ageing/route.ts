/**
 * GET /api/reports/ageing — overdue invoices bucketed by days past due
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("reports.view",
  async () => {
    const invoices = await (await collection("invoices")).find({ status: "Overdue" }).toArray();
    const now = new Date();
    const buckets = [
      { label: "1-30 days", min: 1, max: 30, count: 0, amount: 0 },
      { label: "31-60 days", min: 31, max: 60, count: 0, amount: 0 },
      { label: "61-90 days", min: 61, max: 90, count: 0, amount: 0 },
      { label: "90+ days", min: 91, max: Infinity, count: 0, amount: 0 },
    ];

    for (const inv of invoices) {
      const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      for (const b of buckets) {
        if (days >= b.min && days <= b.max) { b.count += 1; b.amount += inv.total ?? 0; break; }
      }
    }

    return NextResponse.json({ totalOverdue: buckets.reduce((s: number, b: any) => s + b.amount, 0), buckets });
  },
);
