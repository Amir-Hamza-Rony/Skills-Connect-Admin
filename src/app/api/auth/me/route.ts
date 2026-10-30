/**
 * GET /api/auth/me
 * Returns the current user from the access token.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";

export const GET = withAuth(async (req) => {
  const auth = req.auth!;
  return NextResponse.json({
    user: {
      id: auth.userId,
      name: auth.name,
      email: auth.email,
      roleNames: auth.roleNames,
      permissions: auth.permissions,
    },
  });
});
