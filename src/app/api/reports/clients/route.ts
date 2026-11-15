/**
 * GET /api/reports/clients — Client report
 *
 * Per-client aggregation: orders, invoiced, collected, outstanding,
 * last order date. Multi-currency aware: amounts grouped by currency.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const clientId = searchParams.get("clientId");
    const currency = searchParams.get("currency");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const orderFilter: Record<string, unknown> = {};
    const invoiceFilter: Record<string, unknown> = {};
    const paymentFilter: Record<string, unknown> = {};
    if (from || to) {
      orderFilter.createdAt = {};
      if (from) (orderFilter.createdAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (orderFilter.createdAt as Record<string, unknown>).$lte = new Date(to);
    }
    if (clientId) {
      const oid = safeObjectId(clientId);
      if (!oid) return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid client id." } }, { status: 400 });
      orderFilter.clientId = oid;
    }

    const [clients, orders, invoices, payments] = await Promise.all([
      (await collection("clients")).find({}).toArray(),
      (await collection("orders")).find(orderFilter).toArray(),
      (await collection("invoices")).find(invoiceFilter).toArray(),
      (await collection("payments")).find(paymentFilter).toArray(),
    ]);

    // Per-client aggregation.
    const clientMap = new Map<string, any>();
    for (const c of clients) {
      clientMap.set(String(c._id), {
        id: String(c._id),
        legalName: c.legalName,
        email: c.email,
        status: c.status,
        orders: 0,
        byCurrency: {} as Record<string, { invoiced: number; collected: number; outstanding: number }>,
        lastOrderDate: null as string | null,
      });
    }

    for (const o of orders) {
      const cid = String(o.clientId);
      const c = clientMap.get(cid);
      if (!c) continue;
      c.orders += 1;
      const cur = o.currency || "AUD";
      if (!c.byCurrency[cur]) c.byCurrency[cur] = { invoiced: 0, collected: 0, outstanding: 0 };
      c.byCurrency[cur].invoiced += Number(o.sellingPrice ?? 0);
      const od = o.createdAt ? new Date(o.createdAt) : null;
      if (!c.lastOrderDate || (od && od > new Date(c.lastOrderDate))) {
        c.lastOrderDate = od ? od.toISOString() : null;
      }
    }

    for (const inv of invoices) {
      if (inv.status === "Void") continue;
      const cid = String(inv.orderId);
      // Find the client via the order.
      const order = orders.find((o: any) => String(o._id) === String(inv.orderId));
      if (!order) continue;
      const c = clientMap.get(String(order.clientId));
      if (!c) continue;
      const cur = inv.currency || "AUD";
      if (!c.byCurrency[cur]) c.byCurrency[cur] = { invoiced: 0, collected: 0, outstanding: 0 };
      c.byCurrency[cur].invoiced += Number(inv.total ?? 0);
    }

    for (const p of payments) {
      if (p.status === "Void" || p.status === "Refunded") continue;
      const cid = String(p.orderId);
      const order = orders.find((o: any) => String(o._id) === String(p.orderId));
      if (!order) continue;
      const c = clientMap.get(String(order.clientId));
      if (!c) continue;
      const cur = p.currency || "AUD";
      if (!c.byCurrency[cur]) c.byCurrency[cur] = { invoiced: 0, collected: 0, outstanding: 0 };
      c.byCurrency[cur].collected += Number(p.allocatedAmount ?? 0);
    }

    // Compute outstanding per currency.
    for (const c of clientMap.values()) {
      for (const cur of Object.keys(c.byCurrency)) {
        c.byCurrency[cur].outstanding = Math.max(0, c.byCurrency[cur].invoiced - c.byCurrency[cur].collected);
      }
    }

    const rows = Array.from(clientMap.values()).filter((c) => c.orders > 0);

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);

    return NextResponse.json({
      clients: paged,
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);
