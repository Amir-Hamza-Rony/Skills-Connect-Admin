/**
 * GET /api/rto-processing/[id] — single processing record
 * PATCH /api/rto-processing/[id] — update processing record with history
 * DELETE /api/rto-processing/[id] — remove processing record
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

const VALID_STATUSES = new Set([
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

export const GET = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid id." } },
        { status: 400 },
      );
    }

    const coll = await collection("rto-processing");
    const doc = await coll.findOne({ _id: oid });
    if (!doc) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "RTO processing record not found." } }, { status: 404 });
    }

    return NextResponse.json({ rtoProcessing: mapDoc(doc) });
  },
);

export const PATCH = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) return invalidId();

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const coll = await collection("rto-processing");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "RTO processing record not found." } }, { status: 404 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const history: Array<Record<string, unknown>> = [];
    const now = new Date();

    const tracked: Array<[string, any]> = [
      ["submissionStatus", body.submissionStatus],
      ["processingStatus", body.processingStatus],
      ["submissionDate", body.submissionDate],
      ["rtoReference", body.rtoReference],
      ["processingFees", body.processingFees],
      ["processingCurrency", body.processingCurrency],
      ["notes", body.notes],
    ];

    for (const [field, value] of tracked) {
      if (value === undefined) continue;
      if (field === "processingFees") {
        const n = value === null ? null : Number(value);
        if (n !== null && (!Number.isFinite(n) || n < 0)) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Processing fees must be non-negative." } },
            { status: 400 },
          );
        }
        update[field] = n;
      } else if (field === "submissionDate") {
        update[field] = value === null ? null : new Date(String(value)).toISOString();
        if (update[field] !== null && Number.isNaN(new Date(update[field] as string).getTime())) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Submission date is invalid." } },
            { status: 400 },
          );
        }
      } else if (field === "processingStatus" || field === "submissionStatus") {
        if (!VALID_STATUSES.has(String(value))) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: `Invalid ${field}.` } },
            { status: 400 },
          );
        }
        update[field] = String(value);
      } else {
        update[field] = String(value).trim() || null;
      }
      if (String(existing[field]) !== String(update[field])) {
        history.push({ timestamp: now, field, before: existing[field], after: update[field], actorId: (req as AuthedRequest).auth!.userId });
      }
    }

    if (history.length > 0) {
      update.$push = { history: { $each: history } } as any;
    }

    await coll.updateOne({ _id: oid }, { $set: update, ...(update.$push ? { $push: update.$push } : {}) });
    const updated = await coll.findOne({ _id: oid });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "rto-processing",
      entityId: String(id),
      action: "update",
      before: {
        processingStatus: existing.processingStatus,
        submissionStatus: existing.submissionStatus,
        submissionDate: existing.submissionDate,
      },
      after: {
        processingStatus: updated?.processingStatus,
        submissionStatus: updated?.submissionStatus,
        submissionDate: updated?.submissionDate,
      },
    });

    return NextResponse.json({ rtoProcessing: mapDoc(updated) });
  },
);

export const DELETE = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) return invalidId();

    const coll = await collection("rto-processing");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "RTO processing record not found." } }, { status: 404 });
    }

    await coll.deleteOne({ _id: oid });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "rto-processing",
      entityId: String(id),
      action: "delete",
      before: {
        orderId: String(existing.orderId),
        processingStatus: existing.processingStatus,
      },
      after: null,
    });

    return NextResponse.json({ ok: true, id: String(oid) });
  },
);

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}
