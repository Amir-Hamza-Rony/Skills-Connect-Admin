/**
 * GET /api/reports/certificate-completion-time — days from order creation to certificate delivered
 * Mirrors Express `GET /reports/certificate-completion-time`. Requires reports.view.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

function parseFilter(searchParams: URLSearchParams): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  for (const key of ["salesAgentId", "sourceAgentId", "rtoId", "qualificationId"] as const) {
    const value = searchParams.get(key);
    if (value) {
      if (!isValidObjectId(value)) {
        throw new Error(`Invalid ${key}.`);
      }
      filter[key] = toObjectId(value);
    }
  }

  const stage = searchParams.get("stage");
  if (stage) filter.status = stage;

  const createdAt: Record<string, Date> = {};
  const from = searchParams.get("from");
  if (from) {
    const d = new Date(`${from}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid 'from' date.");
    createdAt.$gte = d;
  }
  const to = searchParams.get("to");
  if (to) {
    const d = new Date(`${to}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid 'to' date.");
    createdAt.$lte = d;
  }
  if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt;

  return filter;
}

function isValidObjectId(id: string): boolean {
  try {
    toObjectId(id);
    return true;
  } catch {
    return false;
  }
}

export const GET = withAuth("reports.view",
  async (req: NextRequest) => {
    let filter: Record<string, unknown>;
    try {
      filter = parseFilter(req.nextUrl.searchParams);
    } catch (err: any) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: err.message ?? "Invalid filter." } },
        { status: 400 },
      );
    }

    const orders = await collection("orders");
    const certs = await collection("certificates");

    const completedOrders = await orders
      .find({ ...filter, certificateStatus: "Delivered to Client" })
      .toArray();

    const orderIds = completedOrders.map((o: any) => o._id);
    const certificateDocs = orderIds.length
      ? await certs.find({ orderId: { $in: orderIds } }).toArray()
      : [];

    const certMap = new Map(
      certificateDocs.map((c: any) => [String(c.orderId), c]),
    );

    const durations: number[] = [];
    for (const o of completedOrders) {
      const cert = certMap.get(String(o._id)) as { deliveredToClientAt?: string | Date } | undefined;
      if (cert?.deliveredToClientAt) {
        durations.push(
          Math.round(
            (new Date(cert.deliveredToClientAt).getTime() -
              new Date(o.createdAt).getTime()) /
              86_400_000,
          ),
        );
      }
    }

    durations.sort((a, b) => a - b);

    return NextResponse.json({
      count: durations.length,
      averageDays:
        durations.length > 0
          ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10
          : 0,
      medianDays:
        durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0,
      minDays: durations.length > 0 ? durations[0] : 0,
      maxDays: durations.length > 0 ? durations[durations.length - 1] : 0,
    });
  },
);
