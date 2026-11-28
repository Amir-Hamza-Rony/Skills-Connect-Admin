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
import { applyFinancialVisibility } from "@/lib/financial-visibility";
import { nextEnrollmentCode } from "@/lib/enrollment-code";
import { newTransactionCurrencyError } from "@/lib/pricing-validation";

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

export const GET = withAuth("orders.view",
  async (req) => {
    const authedReq = req as AuthedRequest;
    const auth = authedReq.auth!;
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

    // --- Data scoping: BDC sees own B2C leads, B2B_AGENT sees own agency ---
    // Fields bdc_id / b2b_agent_id are added in Phase 1; the filter is ready
    // when they exist. Until then, no orders match (empty result is correct).
    if (auth.role === "BDC" || auth.roleNames.includes("BDC")) {
      filter.bdc_id = auth.userId;
    } else if (auth.role === "B2B_AGENT" || auth.roleNames.includes("B2B_AGENT")) {
      filter.b2b_agent_id = auth.userId;
    }
    // SUPER_ADMIN and ADMIN see all (no filter added).

    const docs = await orders.find(filter).sort({ createdAt: -1 }).toArray();
    return NextResponse.json({
      orders: docs.map((o: any) => {
        const item: Record<string, unknown> = {
          id: String(o._id),
          clientId: String(o.clientId),
          qualificationId: String(o.qualificationId),
          salesAgentId: String(o.salesAgentId),
          sourceAgentId: String(o.sourceAgentId),
          rtoId: String(o.rtoId),
          status: o.status,
          sellingPrice: o.sellingPrice,
          otherCost: o.otherCost,
          currency: o.currency,
          priceCategoryId: o.priceCategoryId ? String(o.priceCategoryId) : null,
          priceListId: o.priceListId ? String(o.priceListId) : null,
          supplierRouteId: o.supplierRouteId ? String(o.supplierRouteId) : null,
          feeTotal: o.feeTotal,
          certificateStatus: o.certificateStatus,
          createdAt: o.createdAt,
          bdc_id: o.bdc_id ?? null,
          b2b_agent_id: o.b2b_agent_id ?? null,
          // M1.4 (D2): canonical API-facing names for the stored fields.
          enrollmentCode: o.enrollmentCode ?? null,
          channelType: o.channel_type ?? null,
          // 4-Layer Controlled Pricing Matrix (docs v5.1 §2, v5.0 §2).
          trueRtoCost: o.trueRtoCost ?? null,
          snapTrueRtoCost: o.snapTrueRtoCost ?? null,
          approvedInternalCost: o.approvedInternalCost ?? null,
          snapApprovedInternalCost: o.snapApprovedInternalCost ?? null,
          b2bWholesalePrice: o.b2bWholesalePrice ?? null,
          snapB2bWholesalePrice: o.snapB2bWholesalePrice ?? null,
          b2cRetailPrice: o.b2cRetailPrice ?? null,
          snapB2cRetailPrice: o.snapB2cRetailPrice ?? null,
          snapSalePrice: o.snapSalePrice ?? null,
          snapAdditionalFees: o.snapAdditionalFees ?? null,
          snapDiscount: o.snapDiscount ?? null,
          snapTotalBilled: o.snapTotalBilled ?? null,
          commissionAmount: o.commissionAmount ?? null,
          statusReasonNote: o.statusReasonNote ?? null,
        };
        // --- Financial field masking ---
        // partner_cost_price (supplierCostSnapshot) hidden from BDC / B2B_AGENT
        if (auth.role === "SUPER_ADMIN" || auth.role === "ADMIN" ||
            auth.roleNames.includes("SUPER_ADMIN") || auth.roleNames.includes("ADMIN")) {
          item.supplierCostSnapshot = o.supplierCostSnapshot;
        }
        // Security hotfix: sellingPrice is hidden from B2B_AGENT; BDC and
        // admins retain it. supplierCostSnapshot stays admin-only above.
        return applyFinancialVisibility(auth, item);
      }),
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
      rtoContactId,
      rtoContactName,
      rplPartnerId,
      trueRtoCost,
      approvedInternalCost,
      b2bWholesalePrice,
      b2cRetailPrice,
      channelType,
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

    // Validate the Qualification–RTO mapping exists and is active.
    const mapping = await (await collection("qualification-rto-mappings")).findOne({
      qualificationId: qualificationOid,
      rtoId: rtoOid,
      status: "active",
    });
    if (!mapping) {
      return NextResponse.json(
        {
          error: {
            code: "NO_QUALIFICATION_RTO_MAPPING",
            message: "No active Qualification–RTO mapping exists for this qualification and RTO.",
          },
        },
        { status: 400 },
      );
    }

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

    // Validate optional RPL Partner reference: must exist and be active.
    let resolvedRplPartnerId: string | null = null;
    if (rplPartnerId) {
      const rplPartnerOid = safeObjectId(String(rplPartnerId));
      if (!rplPartnerOid) {
        return NextResponse.json(
          { error: { code: "INVALID_ID", message: "Invalid RPL partner id format." } },
          { status: 400 },
        );
      }
      const rplPartners = await collection("rpl_partners");
      const rplPartner = await rplPartners.findOne({ _id: rplPartnerOid });
      if (!rplPartner) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "RPL partner not found." } },
          { status: 404 },
        );
      }
      if (String(rplPartner.status) !== "active") {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "RPL partner is not active." } },
          { status: 400 },
        );
      }
      resolvedRplPartnerId = String(rplPartner._id);
    }

    // Resolve the client selling price from the price list (server-side).
    // Client-submitted sellingPrice is only a fallback when no price list applies.
    let resolvedPriceListId: string | null = null;
    let resolvedPriceCategoryId: string | null = null;
    let resolvedSellingPrice = Number(sellingPrice);

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
      }
    }

    // New orders must use AUD only.
    const currencyError = newTransactionCurrencyError("AUD");
    if (currencyError) {
      return NextResponse.json(
        { error: { code: currencyError.code, message: currencyError.message } },
        { status: 400 },
      );
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
          currency: "AUD",
          isOptional: f.isOptional !== false,
        });
        feeTotal += Number(f.amount);
      }
    }

    const orders = await collection("orders");
    const insertDoc: Record<string, unknown> = {
      clientId: clientOid,
      qualificationId: qualificationOid,
      salesAgentId: salesAgentOid,
      sourceAgentId: sourceAgentOid,
      rtoId: rtoOid,
      status: "DRAFT",
      evidenceStatus: "Not Started",
      rtoSubmissionStatus: "Not Ready",
      certificateStatus: "Not Issued",
      sellingPrice: resolvedSellingPrice,
      supplierCostSnapshot,
      otherCost: Number(otherCost),
      currency: "AUD",
      priceCategoryId: resolvedPriceCategoryId,
      priceListId: resolvedPriceListId,
      supplierRouteId,
      rtoContactId: rtoContactId ? safeObjectId(String(rtoContactId)) : null,
      rtoContactName: rtoContactName ? String(rtoContactName).trim() || null : null,
      rplPartnerId: resolvedRplPartnerId,
      additionalFees,
      feeTotal,
      completedAt: null,
      history: [{ timestamp: now, field: "status", before: "—", after: "DRAFT" }],
      createdAt: now,
      updatedAt: now,
      // 4-Layer Controlled Pricing Matrix (docs v5.1 §2, v5.0 §2).
      trueRtoCost: trueRtoCost !== undefined ? Number(trueRtoCost) : null,
      approvedInternalCost: approvedInternalCost !== undefined ? Number(approvedInternalCost) : null,
      b2bWholesalePrice: b2bWholesalePrice !== undefined ? Number(b2bWholesalePrice) : null,
      b2cRetailPrice: b2cRetailPrice !== undefined ? Number(b2cRetailPrice) : null,
      channel_type: channelType ?? null,
    };
    // Tag enrollment with the creating agent for Phase 1 data scoping.
    if (actor.role === "BDC" || actor.roleNames.includes("BDC")) {
      insertDoc.bdc_id = actor.userId;
      insertDoc.channel_type = "IN_HOUSE_B2C";
    } else if (
      actor.role === "B2B_AGENT" ||
      actor.roleNames.includes("B2B_AGENT") ||
      actor.role === "EXTERNAL_BROKER" ||
      actor.roleNames.includes("EXTERNAL_BROKER")
    ) {
      insertDoc.b2b_agent_id = actor.userId;
      insertDoc.channel_type = "EXTERNAL_B2B";
    }
    // M1.4 (D2): the enrollment code is allocated server-side immediately
    // before insert. A bounded retry handles a legacy/manual collision with
    // the unique partial index; codes are never reused silently.
    const MAX_CODE_ATTEMPTS = 5;
    let result: Awaited<ReturnType<typeof orders.insertOne>> | null = null;
    let enrollmentCode: string | null = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const candidateCode = await nextEnrollmentCode();
      try {
        result = await orders.insertOne({ ...insertDoc, enrollmentCode: candidateCode });
        enrollmentCode = candidateCode;
        break;
      } catch (err: any) {
        if (err?.code !== 11000) throw err;
        if (attempt === MAX_CODE_ATTEMPTS - 1) {
          return NextResponse.json(
            {
              error: {
                code: "ENROLLMENT_CODE_EXHAUSTED",
                message: "Could not allocate a unique enrollment code.",
              },
            },
            { status: 500 },
          );
        }
      }
    }
    if (!result) {
      return NextResponse.json(
        { error: { code: "ENROLLMENT_CODE_EXHAUSTED", message: "Could not allocate an enrollment code." } },
        { status: 500 },
      );
    }

    const orderId = String(result.insertedId);

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "order",
      entityId: orderId,
      action: "create",
      before: null,
      after: {
        status: "DRAFT",
        sellingPrice: resolvedSellingPrice,
        supplierCostSnapshot,
        otherCost: Number(otherCost),
        priceListId: resolvedPriceListId,
        priceCategoryId: resolvedPriceCategoryId,
        supplierRouteId,
        feeTotal,
        enrollmentCode,
        channelType: insertDoc.channel_type ?? null,
        trueRtoCost: insertDoc.trueRtoCost,
        approvedInternalCost: insertDoc.approvedInternalCost,
        b2bWholesalePrice: insertDoc.b2bWholesalePrice,
        b2cRetailPrice: insertDoc.b2cRetailPrice,
        rplPartnerId: resolvedRplPartnerId,
      },
    });

    const docReqs = await collection("document_requirements");
    await docReqs.insertMany([
      "Identity (passport / licence)", "USI transcript", "Employment evidence", "Reference letter", "Photos / skills evidence", "RTO enrolment kit"
    ].map((t) => ({ orderId: result.insertedId, type: t, status: "Not Received", createdAt: now })));

    const certs = await collection("certificates");
    await certs.insertOne({ orderId: result.insertedId, status: "Not Issued", createdAt: now });

    return NextResponse.json(
      { order: { id: orderId, enrollmentCode, channelType: insertDoc.channel_type ?? null } },
      { status: 201 },
    );
  },
);
