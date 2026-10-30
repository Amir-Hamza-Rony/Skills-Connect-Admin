/**
 * GET /api/integrations/quickbooks/connect — OAuth authorization URL
 * Mirrors Express `GET /integrations/quickbooks/connect`. Requires settings.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";

export const GET = withAuth("settings.manage",
  async (req: NextRequest) => {
    try {
      const mod = await import("@/lib/quickbooks");
      const url = await mod.authorizationUrl?.((req as any)?.auth?.userId ?? "unknown");
      if (!url) {
        return NextResponse.json(
          { error: { code: "QB_NOT_CONFIGURED", message: "QuickBooks client credentials are not set." } },
          { status: 422 },
        );
      }
      return NextResponse.json({ url });
    } catch {
      return NextResponse.json(
        { error: { code: "QB_NOT_CONFIGURED", message: "QuickBooks client credentials are not set." } },
        { status: 422 },
      );
    }
  },
);
