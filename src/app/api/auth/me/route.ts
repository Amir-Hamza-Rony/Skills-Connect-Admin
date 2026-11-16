/**
 * GET /api/auth/me
 * Returns the current user from the access token.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";
import type { RoleName } from "@/lib/types";

export const GET = withAuth(async (req) => {
  const auth = req.auth!;
  return NextResponse.json({
    user: {
      id: auth.userId,
      name: auth.name,
      full_name: auth.full_name ?? auth.name,
      email: auth.email,
      role: auth.role ?? (auth.roleNames[0] as RoleName),
      roleNames: auth.roleNames,
      agency_name: auth.agency_name ?? null,
      b2b_tier: auth.b2b_tier ?? "SILVER",
      default_commission_pct: auth.default_commission_pct ?? 0,
      permissions: auth.permissions,
    },
  });
});
