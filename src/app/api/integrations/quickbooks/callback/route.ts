/**
 * GET /api/integrations/quickbooks/callback — OAuth callback
 * Mirrors Express `GET /integrations/quickbooks/callback`. Requires settings.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";

export const GET = withAuth("settings.manage",
  async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const code = searchParams.get("code");
    const realmId = searchParams.get("realmId");
    const state = searchParams.get("state");

    if (!code || !realmId || !state) {
      return NextResponse.json(
        { error: { code: "INVALID_CALLBACK", message: "Missing code, realmId or state." } },
        { status: 400 },
      );
    }

    if (state !== (req as any)?.auth?.userId) {
      return NextResponse.json(
        { error: { code: "STATE_MISMATCH", message: "OAuth state does not match this session." } },
        { status: 403 },
      );
    }

    try {
      const mod = await import("@/lib/quickbooks");
      const result = await mod.exchangeCodeForTokens?.(code, realmId);
      if (!result?.ok) {
        return NextResponse.json(
          { error: { code: "QB_TOKEN_EXCHANGE_FAILED", message: result?.error ?? "Token exchange failed." } },
          { status: 422 },
        );
      }
      return NextResponse.json({ connected: true, realmId });
    } catch {
      return NextResponse.json(
        { error: { code: "QB_TOKEN_EXCHANGE_FAILED", message: "Token exchange failed." } },
        { status: 422 },
      );
    }
  },
);
