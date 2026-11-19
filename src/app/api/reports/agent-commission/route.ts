/**
 * GET /api/reports/agent-commission — Agent commission report
 *
 * Reports only commission records that management has approved or paid.
 * "calculated" records are deliberately excluded: until approval they are a
 * proposal, not a verified earning. Amounts are grouped per commission
 * currency and are never added across currencies.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { canViewAllFinancials } from "@/lib/financial-visibility";

type Row = {
  agentName: string;
  eligibleDeals: number;
  commissionEarned: number;
  commissionCurrency: string;
  commissionPaid: number;
  commissionOutstanding: number;
};

type Totals = {
  eligibleDeals: number;
  commissionEarned: number;
  commissionPaid: number;
  commissionOutstanding: number;
};

function zeroTotals(): Totals {
  return {
    eligibleDeals: 0,
    commissionEarned: 0,
    commissionPaid: 0,
    commissionOutstanding: 0,
  };
}

const UNAVAILABLE = {
  agentCommission: [] as Row[],
  total: 0,
  page: 1,
  pageSize: 50,
  pages: 1,
  totals: zeroTotals(),
  totalsByCurrency: {} as Record<string, Totals>,
  availability: {
    commission: false,
    reason: "Commission data is not available for this role.",
  },
};

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const auth = req.auth!;

    // Commission is an administrative financial report. Agents (BDC /
    // B2B_AGENT) must never see another agent's commission, and there is no
    // verified user-id -> agents-collection mapping for a safe personal view.
    if (!canViewAllFinancials(auth)) {
      return NextResponse.json(UNAVAILABLE);
    }

    const { searchParams } = req.nextUrl;
    const agentIdParam = searchParams.get("agentId");
    const periodMonthParam = searchParams.get("periodMonth");
    const periodYearParam = searchParams.get("periodYear");

    const recordFilter: Record<string, unknown> = {
      status: { $in: ["approved", "paid"] },
    };

    if (agentIdParam) {
      const agentOid = safeObjectId(agentIdParam);
      if (!agentOid) {
        return NextResponse.json(
          { error: { code: "INVALID_ID", message: "Invalid agent id." } },
          { status: 400 },
        );
      }
      recordFilter.agentId = agentOid;
    }
    if (periodMonthParam) {
      const month = Number(periodMonthParam);
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid periodMonth." } },
          { status: 400 },
        );
      }
      recordFilter.periodMonth = month;
    }
    if (periodYearParam) {
      const year = Number(periodYearParam);
      if (!Number.isInteger(year)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid periodYear." } },
          { status: 400 },
        );
      }
      recordFilter.periodYear = year;
    }

    const [agents, records, payouts] = await Promise.all([
      (await collection("agents")).find({}).toArray(),
      (await collection("commission_records")).find(recordFilter).toArray(),
      (await collection("commission_payouts")).find({}).toArray(),
    ]);

    const agentMap = new Map(agents.map((a: any) => [String(a._id), a.name]));

    const paidByRecord = new Map<string, number>();
    for (const p of payouts) {
      if (p.status === "failed") continue;
      const key = String(p.commissionRecordId);
      paidByRecord.set(key, (paidByRecord.get(key) ?? 0) + Number(p.amount ?? 0));
    }

    const byAgent = new Map<string, Row & { agentId: string }>();
    const byCurrency: Record<string, Totals> = {};

    for (const rec of records) {
      const key = String(rec.agentId);
      const currency = String(rec.commissionCurrency || "AUD");
      const earned = Number(rec.commissionAmount ?? 0);
      const paid = paidByRecord.get(String(rec._id)) ?? 0;
      const outstanding = Math.max(0, earned - paid);

      const row = byAgent.get(key) ?? {
        agentId: key,
        agentName: String(agentMap.get(key) ?? key),
        eligibleDeals: 0,
        commissionEarned: 0,
        commissionCurrency: currency,
        commissionPaid: 0,
        commissionOutstanding: 0,
      };
      row.eligibleDeals += Number(rec.eligibleDealCount ?? 0);
      row.commissionEarned += earned;
      row.commissionPaid += paid;
      row.commissionOutstanding += outstanding;
      byAgent.set(key, row);

      if (!byCurrency[currency]) byCurrency[currency] = zeroTotals();
      byCurrency[currency].eligibleDeals += Number(rec.eligibleDealCount ?? 0);
      byCurrency[currency].commissionEarned += earned;
      byCurrency[currency].commissionPaid += paid;
      byCurrency[currency].commissionOutstanding += outstanding;
    }

    const rows = Array.from(byAgent.values());
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);

    const currencies = Object.keys(byCurrency);
    const totals = currencies.length === 1
      ? byCurrency[currencies[0]]
      : currencies.length === 0
        ? zeroTotals()
        : null;

    return NextResponse.json({
      agentCommission: paged,
      total: rows.length,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(rows.length / pageSize)),
      totals,
      totalsByCurrency: byCurrency,
      mixedCurrency: currencies.length > 1,
      availability: {
        commission: rows.length > 0,
        reason: rows.length === 0
          ? "No approved or paid commission records are available for the selected filters."
          : undefined,
      },
    });
  },
);
