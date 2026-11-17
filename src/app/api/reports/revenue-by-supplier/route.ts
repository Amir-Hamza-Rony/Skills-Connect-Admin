/**
 * GET /api/reports/revenue-by-supplier — revenue by source agent and by RTO
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
    const agents = await collection("agents");
    const users = await collection("users");

    const [allOrderDocs, agentDocs, userDocs] = await Promise.all([
      orders.find().toArray(),
      agents.find().toArray(),
      users.find().toArray(),
    ]);

    const orderDocs = filterOrdersByRole(auth, allOrderDocs);

    const allAgentsMap = new Map<string, string>();
    for (const a of agentDocs) allAgentsMap.set(String(a._id), a.name);
    for (const u of userDocs) allAgentsMap.set(String(u._id), u.name);

    const bySourceAgent: Record<string, { orders: number; revenue: number }> = {};
    const byRto: Record<string, { orders: number; revenue: number }> = {};

    for (const o of orderDocs) {
      const sourceKey = allAgentsMap.get(String(o.sourceAgentId)) ?? String(o.sourceAgentId);
      if (!bySourceAgent[sourceKey]) bySourceAgent[sourceKey] = { orders: 0, revenue: 0 };
      bySourceAgent[sourceKey].orders += 1;
      bySourceAgent[sourceKey].revenue += o.sellingPrice ?? 0;

      const rtoKey = String(o.rtoId);
      if (!byRto[rtoKey]) byRto[rtoKey] = { orders: 0, revenue: 0 };
      byRto[rtoKey].orders += 1;
      byRto[rtoKey].revenue += o.sellingPrice ?? 0;
    }

    const result = {
      bySourceAgent: Object.entries(bySourceAgent)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a: any, b: any) => b.revenue - a.revenue),
      byRto: Object.entries(byRto)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a: any, b: any) => b.revenue - a.revenue),
    };
    // Security hotfix: revenue is derived from sellingPrice -> B2B_AGENT only.
    applyFinancialVisibility(auth, result);
    return NextResponse.json(result);
  },
);