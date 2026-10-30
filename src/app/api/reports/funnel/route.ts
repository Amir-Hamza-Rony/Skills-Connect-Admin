/**
 * GET /api/reports/funnel — orders by stage
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req) => {
    const orders = await (await collection("orders")).find().toArray();
    const byStage = new Map<string, number>();
    for (const o of orders) byStage.set(o.status, (byStage.get(o.status) ?? 0) + 1);

    const total = orders.length;
    const completed = byStage.get("Completed") ?? 0;

    return NextResponse.json({
      total,
      completed,
      conversionPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
      byStage: [...byStage.entries()].map(([s, c]) => ({ stage: s, count: c, percent: total > 0 ? Math.round((c / total) * 100) : 0 })),
    });
  },
);
