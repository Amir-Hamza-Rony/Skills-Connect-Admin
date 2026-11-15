/**
 * POST /api/integrations/quickbooks/disconnect — disconnect QuickBooks
 * Requires settings.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { disconnect } from "@/lib/quickbooks";

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const result = await disconnect();
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: "QB_DISCONNECT_FAILED", message: result.error ?? "Disconnect failed." } },
        { status: 500 },
      );
    }
    return NextResponse.json({ connected: false });
  },
);
