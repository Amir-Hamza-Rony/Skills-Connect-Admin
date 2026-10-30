/**
 * GET /api/integrations/quickbooks/sync — list sync records
 * Mirrors Express `GET /integrations/quickbooks/sync`. Requires finance.view.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";

export const GET = withAuth("finance.view",
  async (req: NextRequest) => {
    try {
      const mod = await import("@/lib/quickbooks");
      const records = await mod.listSyncRecords?.();
      return NextResponse.json({ records: records ?? [] });
    } catch {
      return NextResponse.json({ records: [] });
    }
  },
);
