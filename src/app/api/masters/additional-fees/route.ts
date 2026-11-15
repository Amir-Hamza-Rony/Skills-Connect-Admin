/**
 * GET /api/masters/additional-fees — list additional fees
 * POST /api/masters/additional-fees — create an additional fee
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
} from "@/lib/pricing-validation";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "pricing.manage";

function mapDoc(d: any) {
  return {
    id: String(d._id),
    applicability: d.applicability,
    referenceId: String(d.referenceId),
    amount: d.amount,
    currency: d.currency,
    description: d.description,
    effectiveFrom: d.effectiveFrom,
    effectiveTo: d.effectiveTo,
    isOptional: d.isOptional,
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
    const applicability = searchParams.get("applicability");
    const referenceId = searchParams.get("referenceId");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (applicability) filter.applicability = applicability;
    if (referenceId) {
      const oid = safeObjectId(referenceId);
      if (!oid) return invalidId();
      filter.referenceId = oid;
    }
    if (status) filter.status = status;

    const coll = await collection("additional_fees");
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
      "applicability",
      "referenceId",
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

    const applicability = String(body.applicability);
    if (!["qualification", "priceCategory"].includes(applicability)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid applicability." } },
        { status: 400 },
      );
    }

    const referenceId = safeObjectId(String(body.referenceId));
    if (!referenceId) return invalidId();

    // Validate referenced record exists.
    const collName = applicability === "qualification" ? "qualifications" : "price_categories";
    const ref = await (await collection(collName)).findOne({ _id: referenceId });
    if (!ref) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: `${applicability} not found.` } },
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

    const status = String(body.status);
    if (!["active", "inactive"].includes(status)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid status." } },
        { status: 400 },
      );
    }

    const isOptional = body.isOptional !== false;

    const now = new Date();
    const coll = await collection("additional_fees");
    const result = await coll.insertOne({
      applicability,
      referenceId,
      amount,
      currency: body.currency,
      description: body.description ? String(body.description).trim() : null,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo ? effectiveTo.toISOString() : null,
      isOptional,
      status,
      createdAt: now,
      updatedAt: now,
    });

    const created = await coll.findOne({ _id: result.insertedId });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "additional_fee",
      entityId: String(created?._id),
      action: "create",
      before: null,
      after: {
        applicability: created?.applicability,
        referenceId: String(created?.referenceId),
        amount: created?.amount,
        currency: created?.currency,
        isOptional: created?.isOptional,
        status: created?.status,
      },
    });

    return NextResponse.json({ additionalFee: mapDoc(created) }, { status: 201 });
  },
);
