/**
 * GET /api/auth/permissions — the RBAC matrix as the server defines it.
 * The SPA uses this instead of its local copy so there is one source of truth.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";

export const GET = withAuth(async () => {
  return NextResponse.json({
    permissions: {
      "users.manage": ["SUPER_ADMIN", "ADMIN"],
      "roles.manage": ["SUPER_ADMIN", "ADMIN"],
      "clients.view": ["SUPER_ADMIN", "ADMIN", "BDC", "B2B_AGENT"],
      "clients.manage": ["SUPER_ADMIN", "ADMIN", "BDC", "B2B_AGENT"],
      "orders.view": ["SUPER_ADMIN", "ADMIN", "BDC", "B2B_AGENT"],
      "orders.manage": ["SUPER_ADMIN", "ADMIN", "BDC", "B2B_AGENT"],
      "qualifications.manage": ["SUPER_ADMIN", "ADMIN"],
      "pricing.manage": ["SUPER_ADMIN", "ADMIN"],
      "documents.view": ["SUPER_ADMIN", "ADMIN", "BDC", "B2B_AGENT"],
      "documents.review": ["SUPER_ADMIN", "ADMIN"],
      "finance.view": ["SUPER_ADMIN", "ADMIN"],
      "finance.manage": ["SUPER_ADMIN", "ADMIN"],
      "reports.view": ["SUPER_ADMIN", "ADMIN", "BDC", "B2B_AGENT"],
      "audit.view": ["SUPER_ADMIN", "ADMIN"],
      "settings.manage": ["SUPER_ADMIN", "ADMIN"],
    },
  });
});
