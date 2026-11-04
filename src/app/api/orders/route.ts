/**
 * GET /api/orders — list orders (requires orders.view)
 * POST /api/orders — create order (requires orders.manage)
 *
 * The supplier cost snapshot is captured server-side from the active supplier
 * route at order creation time. The client never sends a supplier cost, so it
 * cannot be invented or overwritten. Existing orders retain their original
 * snapshot; supplier price changes (new/expired routes) never touch them.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { Currency } from "@/lib/types";

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

export const GET = withAuth("orders.view",
  async (req) => {
    const orders = await collection("orders");
    const { searchParams } = req.nextUrl;
    const filter: Record<string, unknown> = {};
    const status = searchParams.get("status");
    const clientId = searchParams.get("clientId");
    if (status) filter.status = status;
    if (clientId) {
      const oid = safeObjectId(clientId);
      if (!oid) return invalidId();
      filter.clientId = oid;
    }

    const docs = await orders.find(filter).sort({ createdAt: -1 }).toArray();
    return NextResponse.json({
      orders: docs.map((o: any) => ({
        id: String(o._id),
        clientId: String(o.clientId),
        qualificationId: String(o.qualificationId),
        salesAgentId: String(o.salesAgentId),
        sourceAgentId: String(o.sourceAgentId),
        rtoId: String(o.rtoId),
        status: o.status,
        sellingPrice: o.sellingPrice,
        supplierCostSnapshot: o.supplierCostSnapshot,
        otherCost: o.otherCost,
        currency: o.currency,
        priceCategoryId: o.priceCategoryId ? String(o.priceCategoryId) : null,
        priceListId: o.priceListId ? String(o.priceListId) : null,
        supplierRouteId: o.supplierRouteId ? String(o.supplierRouteId) : null,
        feeTotal: o.feeTotal,
        certificateStatus: o.certificateStatus,
        createdAt: o.createdAt,
      })),
    });
  },
);

export const POST = withAuth("orders.manage",
  async (req) => {
    const actor = (req as AuthedRequest).auth!;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const {
      clientId,
      qualificationId,
      salesAgentId,
      sourceAgentId,
      rtoId,
      sellingPrice,
      otherCost = 0,
      priceCategoryId,
      priceListId,
    } = body;

    if (
      !clientId || !qualificationId || !salesAgentId || !sourceAgentId || !rtoId ||
      sellingPrice === undefined
    ) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Missing required fields." } },
        { status: 400 },
      );
    }

    const clientOid = safeObjectId(clientId);
    const qualificationOid = safeObjectId(qualificationId);
    const salesAgentOid = safeObjectId(salesAgentId);
    const sourceAgentOid = safeObjectId(sourceAgentId);
    const rtoOid = safeObjectId(rtoId);
    if (
      !clientOid || !qualificationOid || !salesAgentOid || !sourceAgentOid || !rtoOid
    ) {
      return invalidId();
    }

    const clients = await collection("clients");
    const client = await clients.findOne({ _id: clientOid });
    if (!client) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Client not found." } }, { status: 404 });

    const now = new Date();

    // Resolve the supplier cost snapshot server-side from the active route.
    const routes = await collection("supplier-routes");
    const route = await routes.findOne({
      qualificationId: qualificationOid,
      sourceAgentId: sourceAgentOid,
      rtoId: rtoOid,
      status: "active",
      $or: [
        { effectiveTo: null },
        { effectiveTo: { $gte: now } },
      ],
      $expr: {
        $lte: [
          { $dateFromString: { dateString: "$effectiveFrom", onError: "$effectiveFrom" } },
          now,
        ],
      },
    } as any);
    if (!route) {
      return NextResponse.json(
        {
          error: {
            code: "NO_ACTIVE_SUPPLIER_ROUTE",
            message: "No active supplier route for this qualification, source agent and RTO.",
          },
        },
        { status: 400 },
      );
    }
    const supplierCostSnapshot = Number(route.wholesaleCost ?? 0);
    const supplierRouteId = String(route._id);

    // Resolve the client selling price from the price list (server-side).
    // Client-submitted sellingPrice is only a fallback when no price list applies.
    let sellingCurrency = "AUD";
    let resolvedPriceListId: string | null = null;
    let resolvedPriceCategoryId: string | null = null;
    let resolvedSellingPrice = Number(sellingPrice);
    let exchangeRate: number | null = null;
    let convertedAmount: number | null = resolvedSellingPrice;

    const priceListIdOid = priceListId ? safeObjectId(String(priceListId)) : null;
    const priceCategoryIdOid = priceCategoryId ? safeObjectId(String(priceCategoryId)) : null;

    if (priceListIdOid) {
      const priceLists = await collection("price_lists");
      const pl = await priceLists.findOne({ _id: priceListIdOid, status: "active" });
      if (!pl) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Price list not found or not active." } },
          { status: 404 },
        );
      }
      resolvedPriceListId = String(pl._id);
      resolvedPriceCategoryId = String(pl.priceCategoryId);
      resolvedSellingPrice = Number(pl.amount);
      sellingCurrency = pl.currency;
    } else if (priceCategoryIdOid) {
      const priceLists = await collection("price_lists");
      const pl = await priceLists.findOne({
        qualificationId: qualificationOid,
        priceCategoryId: priceCategoryIdOid,
        status: "active",
        $or: [
          { effectiveTo: null },
          { effectiveTo: { $gte: now } },
        ],
        $expr: {
          $lte: [
            { $dateFromString: { dateString: "$effectiveFrom", onError: "$effectiveFrom" } },
            now,
          ],
        },
      } as any);
      if (pl) {
        resolvedPriceListId = String(pl._id);
        resolvedPriceCategoryId = String(pl.priceCategoryId);
        resolvedSellingPrice = Number(pl.amount);
        sellingCurrency = pl.currency;
      }
    }

    // Exchange-rate snapshot: placeholder 1 unless a real FX source is configured.
    if (sellingCurrency !== "AUD") {
      exchangeRate = 1;
      convertedAmount = resolvedSellingPrice;
    } else {
      convertedAmount = resolvedSellingPrice;
    }

    // Capture additional fees applicable to the qualification (snapshot).
    const additionalFees: Array<{
      feeId: string;
      description: string | null;
      amount: number;
      currency: Currency;
      isOptional: boolean;
    }> = [];
    let feeTotal = 0;
    if (qualificationOid) {
      const fees = await (await collection("additional_fees"))
        .find({
          applicability: "qualification",
          referenceId: qualificationOid,
          status: "active",
          $or: [
            { effectiveTo: null },
            { effectiveTo: { $gte: now } },
          ],
        } as any)
        .toArray();
      for (const f of fees) {
        additionalFees.push({
          feeId: String(f._id),
          description: f.description,
          amount: Number(f.amount),
          currency: f.currency,
          isOptional: f.isOptional !== false,
        });
        feeTotal += Number(f.amount);
      }
    }

    const orders = await collection("orders");
    const result = await orders.insertOne({
      clientId: clientOid,
      qualificationId: qualificationOid,
      salesAgentId: salesAgentOid,
      sourceAgentId: sourceAgentOid,
      rtoId: rtoOid,
      status: "New",
      evidenceStatus: "Not Started",
      rtoSubmissionStatus: "Not Ready",
      certificateStatus: "Not Issued",
      sellingPrice: resolvedSellingPrice,
      supplierCostSnapshot,
      otherCost: Number(otherCost),
      currency: sellingCurrency,
      priceCategoryId: resolvedPriceCategoryId,
      priceListId: resolvedPriceListId,
      supplierRouteId,
      exchangeRate,
      convertedAmount,
      additionalFees,
      feeTotal,
      completedAt: null,
      history: [{ timestamp: now, field: "status", before: "—", after: "New" }],
      createdAt: now,
      updatedAt: now,
    });

    const orderId = String(result.insertedId);

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "order",
      entityId: orderId,
      action: "create",
      before: null,
      after: {
        status: "New",
        sellingPrice: resolvedSellingPrice,
        sellingCurrency,
        supplierCostSnapshot,
        otherCost: Number(otherCost),
        priceListId: resolvedPriceListId,
        priceCategoryId: resolvedPriceCategoryId,
        supplierRouteId,
        feeTotal,
      },
    });

    const docReqs = await collection("document_requirements");
    await docReqs.insertMany([
      "Identity (passport / licence)", "USI transcript", "Employment evidence", "Reference letter", "Photos / skills evidence", "RTO enrolment kit"
    ].map((t) => ({ orderId: result.insertedId, type: t, status: "Not Received", createdAt: now })));

    const certs = await collection("certificates");
    await certs.insertOne({ orderId: result.insertedId, status: "Not Issued", createdAt: now });

    return NextResponse.json({ order: { id: orderId } }, { status: 201 });
  },
);
