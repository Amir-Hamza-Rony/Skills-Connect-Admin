/**
 * GET /api/audit — paged audit events (requires audit.view)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("audit.view",
  async (req) => {
    const { searchParams } = req.nextUrl;
    const entityType = searchParams.get("entityType");
    const action = searchParams.get("action");
    const page = Number(searchParams.get("page") ?? 1);
    const pageSize = Math.min(Number(searchParams.get("pageSize") ?? 50), 200);

    const filter: Record<string, unknown> = {};
    if (entityType) filter.entityType = entityType;
    if (action) filter.action = action;

    const auditLogs = await collection("audit_logs");
    const [docs, total] = await Promise.all([
      auditLogs.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      auditLogs.countDocuments(filter),
    ]);

    return NextResponse.json({
      events: docs.map((d: any) => ({
        id: String(d._id),
        timestamp: d.createdAt,
        actorId: d.actorId ?? null,
        actorEmail: d.actorEmail ?? null,
        entityType: d.entityType,
        entityId: d.entityId ?? null,
        action: d.action,
        before: d.before ?? null,
        after: d.after ?? null,
      })),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);
