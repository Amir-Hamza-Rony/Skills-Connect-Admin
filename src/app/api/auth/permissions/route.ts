/**
 * GET /api/auth/permissions — the RBAC matrix as the server defines it.
 *
 * Derived from `ROLE_PERMISSIONS` so this endpoint can never drift from the
 * matrix used by `withAuth` at login. The SPA currently reads permissions
 * from the JWT; this endpoint is the authoritative reference for tooling.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";
import { ALL_PERMISSIONS, ALL_ROLES, ROLE_PERMISSIONS } from "@/lib/permissions";

export const GET = withAuth(async () => {
  const permissions: Record<string, string[]> = {};
  for (const permission of ALL_PERMISSIONS) {
    permissions[permission] = ALL_ROLES.filter((role) =>
      ROLE_PERMISSIONS[role].includes(permission),
    );
  }

  return NextResponse.json({
    permissions,
    roles: ALL_ROLES,
  });
});
