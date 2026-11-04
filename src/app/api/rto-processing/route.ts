/**
 * GET /api/rto-processing — list RTO processing records (filter by orderId)
 * POST /api/rto-processing — create an RTO processing record for an order
 *
 * One processing record per order. Tracks submission date, processing status,
 * RTO reference, fees and processing history.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "rto.manage";

function mapDoc(d: any) {
  return {
    id: String(d._id),
    orderId: String(d.orderId),
    rtoId: String(d.rtoId),
    submissionStatus: d.submissionStatus,
    submissionDate: d.submissionDate,
    processingStatus: d.processingStatus,
    rtoReference: d.rtoReference,
    processingFees: d.processingFees,
    processingCurrency: d.processingCurrency,
    notes: d.notes,
    history: d.history,
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
    const orderId = searchParams.get("orderId");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (orderId) {
      const oid = safeObjectId(orderId);
      if (!oid) {
        return NextResponse.json(
          { error: { code: "INVALID_ID", message: "Invalid order id." } },
          { status: 400 },
        );
      }
      filter.orderId = oid;
    }
    if (status) filter.processingStatus = status;

    const coll = await collection("rto-processing");
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

    const orderId = safeObjectId(String(body.orderId));
    const rtoId = safeObjectId(String(body.rtoId));
    if (!orderId || !rtoId) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "orderId and rtoId are required." } },
        { status: 400 },
      );
    }

    const ordersColl = await collection("orders");
    const rtosColl = await collection("rtos");
    const [order, rto] = await Promise.all([
      ordersColl.findOne({ _id: orderId }),
      rtosColl.findOne({ _id: rtoId }),
    ]);
    if (!order) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });
    }
    if (!rto) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "RTO not found." } }, { status: 404 });
    }

    const rtoProcColl = await collection("rto-processing");
    const existing = await rtoProcColl.findOne({ orderId });
    if (existing) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "An RTO processing record already exists for this order." } },
        { status: 409 },
      );
    }

    const submissionStatus = String(body.submissionStatus ?? "Not Started");
    const processingStatus = String(body.processingStatus ?? "Not Started");
    const validStatuses = new Set([
      "Not Started",
      "Submission Prepared",
      "Submitted to RTO",
      "Acknowledged",
      "Under Assessment",
      "Additional Evidence Required",
      "Approved",
      "Issued",
      "Rejected",
    ]);
    if (!validStatuses.has(submissionStatus) || !validStatuses.has(processingStatus)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid status." } },
        { status: 400 },
      );
    }

    const processingFees =
      body.processingFees === undefined || body.processingFees === null
        ? null
        : Number(body.processingFees);
    if (processingFees !== null && (!Number.isFinite(processingFees) || processingFees < 0)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Processing fees must be a non-negative number." } },
        { status: 400 },
      );
    }

    const now = new Date();
    const submissionDate = body.submissionDate ? new Date(String(body.submissionDate)) : null;
    if (submissionDate && Number.isNaN(submissionDate.getTime())) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Submission date is invalid." } },
        { status: 400 },
      );
    }

    const historyEntry: Record<string, unknown> = {
      timestamp: now,
      field: "processingStatus",
      before: "—",
      after: processingStatus,
      actorId: (req as AuthedRequest).auth!.userId,
    };

    const coll = await collection("rto-processing");
    const result = await coll.insertOne({
      orderId,
      rtoId,
      submissionStatus,
      submissionDate: submissionDate ? submissionDate.toISOString() : null,
      processingStatus,
      rtoReference: body.rtoReference ? String(body.rtoReference).trim() : null,
      processingFees,
      processingCurrency: body.processingCurrency ? String(body.processingCurrency) : null,
      notes: body.notes ? String(body.notes).trim() : null,
      history: [historyEntry],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const created = await coll.findOne({ _id: result.insertedId });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "rto-processing",
      entityId: String(created?._id),
      action: "create",
      before: null,
      after: {
        orderId: String(created?.orderId),
        rtoId: String(created?.rtoId),
        processingStatus: created?.processingStatus,
        submissionStatus: created?.submissionStatus,
      },
    });

    return NextResponse.json({ rtoProcessing: mapDoc(created) }, { status: 201 });
  },
);
