/**
 * GET /api/reports/revenue — revenue by qualification and agent
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req) => {
    const { searchParams } = req.nextUrl;
    const filter: Record<string, unknown> = {};
    const qual = searchParams.get("qualificationId");
    if (qual) filter.qualificationId = toObjectId(qual);

    const [orders, qualifications, users] = await Promise.all([
      (await collection("orders")).find(filter).toArray(),
      (await collection("qualifications")).find().toArray(),
      (await collection("users")).find().toArray(),
    ]);

    const qualMap = new Map<string, string>(qualifications.map((q: any) => [String(q._id), q.code]));
    const agentMap = new Map<string, string>(users.map((a: any) => [String(a._id), a.name]));

    const byQual = new Map<string, { orders: number; revenue: number }>();
    const byAgent = new Map<string, { orders: number; revenue: number }>();

    for (const o of orders) {
      const qName = qualMap.get(String(o.qualificationId)) ?? String(o.qualificationId);
      const aName = agentMap.get(String(o.salesAgentId)) ?? String(o.salesAgentId);

      const q = byQual.get(qName) ?? { orders: 0, revenue: 0 };
      q.orders += 1; q.revenue += o.sellingPrice ?? 0; byQual.set(qName, q);

      const a = byAgent.get(aName) ?? { orders: 0, revenue: 0 };
      a.orders += 1; a.revenue += o.sellingPrice ?? 0; byAgent.set(aName, a);
    }

    return NextResponse.json({
      byQualification: [...byQual.entries()].map(([n, v]) => ({ name: n, ...v })),
      byAgent: [...byAgent.entries()].map(([n, v]) => ({ name: n, ...v })),
    });
  },
);
