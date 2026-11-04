/**
 * GET /api/reconciliation — list reconciliation items (mismatches between local
 * financial records and QuickBooks).
 *
 * Surfaces: local records not synced, QB records not imported, failed syncs,
 * conflicts. Does not auto-resolve — financial conflicts require manual review.
 *
 * Requires finance.reconcile.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "finance.reconcile";

type ReconItem = {
  id: string;
  entityType: "invoice" | "payment" | "customer";
  entityId: string;
  qbReference: string | null;
  issue:
    | "amount_mismatch"
    | "currency_mismatch"
    | "status_mismatch"
    | "missing_locally"
    | "missing_in_qb"
    | "duplicate_qb_reference";
  localValue: unknown;
  qbValue: unknown;
  status: "open" | "resolved" | "ignored";
  createdAt: string;
};

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

function itemId(entityType: string, entityId: string, issue: string): string {
  return `${entityType}:${entityId}:${issue}`;
}

export const GET = withAuth(
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") ?? "open";
    const entityType = searchParams.get("entityType");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const items: ReconItem[] = [];

    // Local invoices/payments not synced to QB → missing_in_qb.
    const invColl = await collection("invoices");
    const invoices = await invColl
      .find({ qbSyncStatus: { $ne: "Synced" }, status: { $ne: "Void" } })
      .toArray();
    for (const inv of invoices) {
      items.push({
        id: itemId("invoice", String(inv._id), "missing_in_qb"),
        entityType: "invoice",
        entityId: String(inv._id),
        qbReference: inv.qbReference ?? null,
        issue: "missing_in_qb",
        localValue: { total: inv.total, currency: inv.currency, status: inv.status },
        qbValue: null,
        status: "open",
        createdAt: inv.createdAt,
      });
    }

    const payColl = await collection("payments");
    const payments = await payColl
      .find({ qbSyncStatus: { $ne: "Synced" }, status: { $nin: ["Void", "Refunded"] } })
      .toArray();
    for (const pay of payments) {
      items.push({
        id: itemId("payment", String(pay._id), "missing_in_qb"),
        entityType: "payment",
        entityId: String(pay._id),
        qbReference: pay.qbReference ?? null,
        issue: "missing_in_qb",
        localValue: { amount: pay.amount, currency: pay.currency, status: pay.status },
        qbValue: null,
        status: "open",
        createdAt: pay.createdAt,
      });
    }

    // Sync records that failed or conflicted.
    const syncColl = await collection("qb_sync_records");
    const syncRecords = await syncColl
      .find({ status: { $in: ["Failed", "Conflict"] } })
      .toArray();
    for (const rec of syncRecords) {
      const issue =
        rec.status === "Conflict"
          ? rec.syncError?.includes("amount")
            ? "amount_mismatch"
            : rec.syncError?.includes("currency")
              ? "currency_mismatch"
              : "status_mismatch"
          : "missing_in_qb";
      items.push({
        id: itemId(rec.entityType, String(rec.entityId), issue),
        entityType: rec.entityType as "invoice" | "payment" | "customer",
        entityId: String(rec.entityId),
        qbReference: rec.qbReference ?? null,
        issue,
        localValue: { status: rec.status, attempts: rec.attempts },
        qbValue: { syncError: rec.syncError, qbReference: rec.qbReference },
        status: "open",
        createdAt: rec.createdAt ?? new Date().toISOString(),
      });
    }

    // Sort: newest first.
    items.sort((a, b) => {
      const aa = new Date(a.createdAt).getTime();
      const bb = new Date(b.createdAt).getTime();
      return bb - aa;
    });

    // Filter.
    let filtered = items;
    if (status !== "all") filtered = filtered.filter((i) => i.status === status);
    if (entityType) filtered = filtered.filter((i) => i.entityType === entityType);

    const total = filtered.length;
    const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

    return NextResponse.json({
      items: pageItems,
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);
