/**
 * GET /api/integrations/quickbooks/sync/[type]/[id] — one entity's sync state
 * Mirrors Express `GET /integrations/quickbooks/sync/:type/:id`. Requires finance.view.
 *
 * POST /api/integrations/quickbooks/sync/[type]/[id] — retry a sync
 * Mirrors Express `POST /integrations/quickbooks/sync/:type/:id`. Requires qb.retry.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";

export const GET = withAuth("finance.view",
  async (req: NextRequest, { params }: { params?: Promise<{ type?: string; id?: string }> | { type?: string; id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { type, id } = resolvedParams;

    if (!type || !id || (type !== "invoice" && type !== "payment")) {
      return NextResponse.json(
        { error: { code: "INVALID_TYPE", message: "Type must be invoice or payment." } },
        { status: 400 },
      );
    }

    try {
      const mod = await import("@/lib/quickbooks");
      const record = await mod.syncRecordFor?.(type as "invoice" | "payment", id);
      if (!record) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Sync record not found." } },
          { status: 404 },
        );
      }
      return NextResponse.json({ record });
    } catch {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Sync record not found." } },
        { status: 404 },
      );
    }
  },
);

export const POST = withAuth("qb.retry",
  async (req: NextRequest, { params }: { params?: Promise<{ type?: string; id?: string }> | { type?: string; id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { type, id } = resolvedParams;

    if (!type || !id || (type !== "invoice" && type !== "payment")) {
      return NextResponse.json(
        { error: { code: "INVALID_TYPE", message: "Type must be invoice or payment." } },
        { status: 400 },
      );
    }

    try {
      const mod = await import("@/lib/quickbooks");
      const actor = { id: (req as any)?.auth?.userId ?? "unknown", email: (req as any)?.auth?.email ?? "" };
      const record = await mod.retrySync?.(type as "invoice" | "payment", id, actor);
      return NextResponse.json({ record });
    } catch (err: any) {
      if (err?.code === "NOT_FOUND") {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Sync record not found." } },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: err?.message ?? "Retry failed." } },
        { status: 400 },
      );
    }
  },
);
