/**
 * GET /api/auth/permissions — the RBAC matrix as the server defines it.
 * The SPA uses this instead of its local copy so there is one source of truth.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";

export const GET = withAuth(async () => {
  return NextResponse.json({
    permissions: {
      "users.manage": ["Super Admin", "Read Only / Manager"],
      "roles.manage": ["Super Admin"],
      "clients.view": ["Super Admin", "Finance", "Operations", "Sales / Closing Agent", "Document Reviewer", "Read Only / Manager"],
      "clients.manage": ["Super Admin", "Finance", "Operations", "Sales / Closing Agent"],
      "orders.view": ["Super Admin", "Finance", "Operations", "Sales / Closing Agent", "Document Reviewer", "Read Only / Manager"],
      "orders.manage": ["Super Admin", "Finance", "Operations", "Sales / Closing Agent"],
      "rto.manage": ["Super Admin", "RTO / Sourcing Manager"],
      "agents.manage": ["Super Admin", "RTO / Sourcing Manager"],
      "qualifications.manage": ["Super Admin", "RTO / Sourcing Manager"],
      "pricing.manage": ["Super Admin", "RTO / Sourcing Manager"],
      "documents.view": ["Super Admin", "Finance", "Operations", "Sales / Closing Agent", "Document Reviewer", "Read Only / Manager"],
      "documents.review": ["Super Admin", "Document Reviewer"],
      "finance.view": ["Super Admin", "Finance", "Operations", "Read Only / Manager"],
      "finance.manage": ["Super Admin", "Finance"],
      "qb.retry": ["Super Admin", "Finance"],
      "reports.view": ["Super Admin", "Finance", "Operations", "Read Only / Manager"],
      "audit.view": ["Super Admin", "Finance", "Operations", "Read Only / Manager"],
      "settings.manage": ["Super Admin"],
    },
  });
});