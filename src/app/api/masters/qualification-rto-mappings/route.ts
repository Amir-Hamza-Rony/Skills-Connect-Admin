/**
 * GET /api/masters/qualification-rto-mappings — list qualification↔RTO mappings
 * POST /api/masters/qualification-rto-mappings — create a mapping
 *
 * Many-to-many relationship between Qualifications and RTOs. Separate from
 * supplier pricing and order-specific selection.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";

const COLLECTION = "qualification-rto-mappings";
const PERMISSION = "qualifications.manage";

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

function mapDoc(d: any) {
  return {
    id: String(d._id),
    qualificationId: String(d.qualificationId),
    rtoId: String(d.rtoId),
    status: d.status,
    effectiveFrom: d.effectiveFrom,
    effectiveTo: d.effectiveTo,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export const GET = withAuth(
  async (req: AuthedRequest) => {
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
    if (!auth?.roleNames?.includes("Super Admin") && !auth?.permissions?.includes(PERMISSION)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const qualificationId = searchParams.get("qualificationId");
    const rtoId = searchParams.get("rtoId");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (qualificationId) {
      const oid = safeObjectId(qualificationId);
      if (!oid) return invalidId();
      filter.qualificationId = oid;
    }
    if (rtoId) {
      const oid = safeObjectId(rtoId);
      if (!oid) return invalidId();
      filter.rtoId = oid;
    }
    if (status) filter.status = status;

    const coll = await collection(COLLECTION);
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
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
    if (!auth?.roleNames?.includes("Super Admin") && !auth?.permissions?.includes(PERMISSION)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const qualificationId = safeObjectId(String(body.qualificationId));
    const rtoId = safeObjectId(String(body.rtoId));
    if (!qualificationId || !rtoId) return invalidId();

    // Validate both records exist.
    const qColl = await collection("qualifications");
    const rColl = await collection("rtos");
    const [qual, rto] = await Promise.all([
      qColl.findOne({ _id: qualificationId }),
      rColl.findOne({ _id: rtoId }),
    ]);
    if (!qual) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Qualification not found." } }, { status: 404 });
    }
    if (!rto) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "RTO not found." } }, { status: 404 });
    }

    const status = String(body.status ?? "active");
    if (!["active", "inactive"].includes(status)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid status." } }, { status: 400 });
    }

    const effectiveFrom = body.effectiveFrom ? new Date(String(body.effectiveFrom)) : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Effective from date is invalid." } }, { status: 400 });
    }
    const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;
    if (effectiveTo && Number.isNaN(effectiveTo.getTime())) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Effective to date is invalid." } }, { status: 400 });
    }

    // Prevent duplicate mappings (same qualification + rto), active or not.
    const mColl = await collection(COLLECTION);
    const existing = await mColl.findOne({
      qualificationId,
      rtoId,
    });
    if (existing) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "A mapping between this qualification and RTO already exists." } },
        { status: 409 },
      );
    }

    const now = new Date();
    const result = await mColl.insertOne({
      qualificationId,
      rtoId,
      status,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo ? effectiveTo.toISOString() : null,
      createdAt: now,
      updatedAt: now,
    });
    const created = await mColl.findOne({ _id: result.insertedId });
    return NextResponse.json({ mapping: mapDoc(created) }, { status: 201 });
  },
);
