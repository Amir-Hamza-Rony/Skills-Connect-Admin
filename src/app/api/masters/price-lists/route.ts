/**
 * GET /api/masters/price-lists — list qualification price lists
 * POST /api/masters/price-lists — create a price list
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import {
  requireFields,
  isValidCurrency,
  isValidDate,
  isPositiveAmount,
  invalidId,
  priceListOverlaps,
} from "@/lib/pricing-validation";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "pricing.manage";

function mapDoc(d: any) {
  return {
    id: String(d._id),
    qualificationId: String(d.qualificationId),
    priceCategoryId: String(d.priceCategoryId),
    amount: d.amount,
    currency: d.currency,
    effectiveFrom: d.effectiveFrom,
    effectiveTo: d.effectiveTo,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function requireAuth(req: AuthedRequest) {
  const auth = req.auth as {
    roleNames?: string[];
    permissions?: string[];
  };
  if (
    !auth?.roleNames?.includes("Super Admin") &&
    !auth?.permissions?.includes(PERMISSION)
  ) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } },
      { status: 403 },
    );
  }
  return null;
}

export const GET = withAuth(
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const { searchParams } = req.nextUrl;
    const qualificationId = searchParams.get("qualificationId");
    const priceCategoryId = searchParams.get("priceCategoryId");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (qualificationId) {
      const oid = safeObjectId(qualificationId);
      if (!oid) return invalidId();
      filter.qualificationId = oid;
    }
    if (priceCategoryId) {
      const oid = safeObjectId(priceCategoryId);
      if (!oid) return invalidId();
      filter.priceCategoryId = oid;
    }
    if (status) filter.status = status;

    const coll = await collection("price_lists");
    const [docs, total] = await Promise.all([
      coll
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      coll.countDocuments(filter),
    ]);

    return NextResponse.json({
      items: docs.map(mapDoc),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const missing = requireFields(body, [
      "qualificationId",
      "priceCategoryId",
      "amount",
      "currency",
      "effectiveFrom",
      "status",
    ]);
    if (missing) {
      return NextResponse.json(
        { error: { code: missing.code, message: missing.message } },
        { status: 400 },
      );
    }

    const qualificationId = safeObjectId(String(body.qualificationId));
    const priceCategoryId = safeObjectId(String(body.priceCategoryId));
    if (!qualificationId || !priceCategoryId) return invalidId();

    // Validate referenced records exist.
    const qColl = await collection("qualifications");
    const cColl = await collection("price_categories");
    const [qual, cat] = await Promise.all([
      qColl.findOne({ _id: qualificationId }),
      cColl.findOne({ _id: priceCategoryId }),
    ]);
    if (!qual) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Qualification not found." } },
        { status: 404 },
      );
    }
    if (!cat) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Price category not found." } },
        { status: 404 },
      );
    }

    const amount = Number(body.amount);
    if (!isPositiveAmount(amount)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Amount must be a non-negative number." } },
        { status: 400 },
      );
    }

    if (!isValidCurrency(body.currency)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid currency." } },
        { status: 400 },
      );
    }

    const effectiveFrom = new Date(String(body.effectiveFrom));
    if (!isValidDate(body.effectiveFrom)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Effective from date is invalid." } },
        { status: 400 },
      );
    }
    const effectiveTo = body.effectiveTo
      ? new Date(String(body.effectiveTo))
      : null;
    if (effectiveTo && !isValidDate(body.effectiveTo)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Effective to date is invalid." } },
        { status: 400 },
      );
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Effective to must be after effective from." } },
        { status: 400 },
      );
    }

    const status = String(body.status);
    if (!["active", "inactive", "draft"].includes(status)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid status." } },
        { status: 400 },
      );
    }

    // Prevent overlapping active price periods for the same qualification + category.
    if (status === "active") {
      const overlaps = await priceListOverlaps(
        qualificationId,
        priceCategoryId,
        effectiveFrom,
        effectiveTo,
      );
      if (overlaps) {
        return NextResponse.json(
          {
            error: {
              code: "CONFLICT",
              message: "An active price list already exists for this qualification and category with an overlapping effective period.",
            },
          },
          { status: 409 },
        );
      }
    }

    const now = new Date();
    const coll = await collection("price_lists");
    const result = await coll.insertOne({
      qualificationId,
      priceCategoryId,
      amount,
      currency: body.currency,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo ? effectiveTo.toISOString() : null,
      status,
      createdAt: now,
      updatedAt: now,
    });

    const created = await coll.findOne({ _id: result.insertedId });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "price_list",
      entityId: String(created?._id),
      action: "create",
      before: null,
      after: {
        qualificationId: String(created?.qualificationId),
        priceCategoryId: String(created?.priceCategoryId),
        amount: created?.amount,
        currency: created?.currency,
        status: created?.status,
      },
    });

    return NextResponse.json({ priceList: mapDoc(created) }, { status: 201 });
  },
);
