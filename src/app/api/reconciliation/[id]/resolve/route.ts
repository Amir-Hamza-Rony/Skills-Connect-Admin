/**
 * POST /api/reconciliation/[id]/resolve — resolve a reconciliation item.
 * Requires finance.reconcile. Records the resolving user, timestamp, and note.
 * Requires a resolutionNote. Status: resolved or ignored.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "finance.reconcile";

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

export const POST = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    if (!id) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid id." } }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const resolutionStatus = String(body.status ?? "");
    if (!["resolved", "ignored"].includes(resolutionStatus)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "status must be 'resolved' or 'ignored'." } },
        { status: 400 },
      );
    }

    const resolutionNote = String(body.resolutionNote ?? "").trim();
    if (!resolutionNote) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "resolutionNote is required." } },
        { status: 400 },
      );
    }

    const actor = (req as AuthedRequest).auth!;
    const now = new Date();

    // Reconciliation items are virtual (computed from invoices/payments/sync
    // records), so resolution is recorded in a qb_reconciliation collection
    // keyed by the item id, rather than mutating source records.
    const coll = await collection("qb_reconciliation");
    const existing = await coll.findOne({ itemId: id });
    if (existing) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "Reconciliation item already resolved." } },
        { status: 409 },
      );
    }

    await coll.insertOne({
      itemId: id,
      status: resolutionStatus,
      resolutionNote,
      resolvedBy: actor.userId ?? null,
      resolvedAt: now.toISOString(),
      createdAt: now.toISOString(),
    });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "reconciliation",
      entityId: id,
      action: "resolve",
      before: null,
      after: { status: resolutionStatus, resolutionNote },
    });

    return NextResponse.json({ ok: true, id, status: resolutionStatus });
  },
);
