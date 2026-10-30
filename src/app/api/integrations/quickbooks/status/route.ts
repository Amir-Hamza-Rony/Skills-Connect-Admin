/**
 * GET /api/integrations/quickbooks/status — QuickBooks connection health
 * Mirrors Express `GET /integrations/quickbooks/status`. Requires finance.view.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";

export const GET = withAuth("finance.view",
  async (req: NextRequest) => {
    try {
      const mod = await import("@/lib/quickbooks");
      const status = await mod.quickBooksStatus?.();
      return NextResponse.json(status ?? { configured: false, authorised: false, realmId: null, sandbox: true });
    } catch {
      return NextResponse.json({ configured: false, authorised: false, realmId: null, sandbox: true });
    }
  },
);
