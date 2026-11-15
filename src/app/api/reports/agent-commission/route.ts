/**
 * GET /api/reports/agent-commission — Agent commission report
 *
 * Per-agent: eligible deal count, commission earned, paid amount,
 * outstanding commission. Uses approved commission rules for tier lookup.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const agentId = searchParams.get("agentId");
    const periodMonth = searchParams.get("periodMonth");
    const periodYear = searchParams.get("periodYear");

    const orderFilter: Record<string, unknown> = {};
    if (from || to) {
      orderFilter.createdAt = {};
      if (from) (orderFilter.createdAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (orderFilter.createdAt as Record<string, unknown>).$lte = new Date(to);
    }

    const [agents, orders, commissionRecords, commissionPayouts] = await Promise.all([
      (await collection("agents")).find({}).toArray(),
      (await collection("orders")).find(orderFilter).toArray(),
      (await collection("commission_records")).find({}).toArray(),
      (await collection("commission_payouts")).find({}).toArray(),
    ]);

    const agentMap = new Map(agents.map((a: any) => [String(a._id), a.name]));

    // Paid-out per commission record.
    const paidByRecord = new Map<string, number>();
    for (const p of commissionPayouts) {
      const m = paidByRecord.get(String(p.commissionRecordId)) || 0;
      paidByRecord.set(String(p.commissionRecordId), m + Number(p.amount ?? 0));
    }

    // Per-agent aggregation from commission records.
    const agentMapResult = new Map<string, {
      agentName: string;
      eligibleDeals: number;
      commissionEarned: number;
      commissionCurrency: string;
      commissionPaid: number;
      commissionOutstanding: number;
    }>();

    for (const rec of commissionRecords) {
    const entry = agentMapResult.get(String(rec.agentId)) || {
      agentName: String(agentMap.get(String(rec.agentId)) ?? rec.agentId),
      eligibleDeals: 0,
      commissionEarned: 0,
      commissionCurrency: rec.commissionCurrency || "AUD",
      commissionPaid: 0,
      commissionOutstanding: 0,
    };
      entry.eligibleDeals += Number(rec.eligibleDealCount ?? 0);
      entry.commissionEarned += Number(rec.commissionAmount ?? 0);
      entry.commissionPaid += paidByRecord.get(String(rec._id)) || 0;
      entry.commissionOutstanding = entry.commissionEarned - entry.commissionPaid;
      agentMapResult.set(String(rec.agentId), entry);
    }

    // Include agents with no commission records but with eligible orders.
    // Eligible orders = Completed orders (default eligibility).
    const eligibleOrders = orders.filter((o: any) => o.status === "Completed");
    for (const o of eligibleOrders) {
      const saId = String(o.salesAgentId);
      if (!agentMapResult.has(saId)) {
        const agent = agents.find((a: any) => String(a._id) === saId);
        agentMapResult.set(saId, {
          agentName: agent?.name ?? saId,
          eligibleDeals: 1,
          commissionEarned: 0,
          commissionCurrency: o.currency || "AUD",
          commissionPaid: 0,
          commissionOutstanding: 0,
        });
      } else {
        agentMapResult.get(saId)!.eligibleDeals += 1;
      }
    }

    const rows = Array.from(agentMapResult.values());
    const total = rows.length;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);

    return NextResponse.json({
      agentCommission: paged,
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      totals: {
        eligibleDeals: rows.reduce((s, r) => s + r.eligibleDeals, 0),
        commissionEarned: rows.reduce((s, r) => s + r.commissionEarned, 0),
        commissionPaid: rows.reduce((s, r) => s + r.commissionPaid, 0),
        commissionOutstanding: rows.reduce((s, r) => s + r.commissionOutstanding, 0),
      },
    });
  },
);
