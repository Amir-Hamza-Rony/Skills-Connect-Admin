/**
 * GET /api/audit/filters — filter vocabulary for audit viewer
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth(async () => {
  const auditLogs = await collection("audit_logs");
  const [entityTypes, actions] = await Promise.all([
    auditLogs.distinct("entityType"),
    auditLogs.distinct("action"),
  ]);
  return NextResponse.json({
    entityTypes: (entityTypes as string[]).sort(),
    actions: (actions as string[]).sort(),
  });
});
