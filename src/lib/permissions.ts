import type { Permission, RoleName } from "@/lib/types"

/**
 * RBAC matrix — Boss reference documents (§3 Role-Based Visibility Matrix).
 *
 * Four roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT.
 * This copy exists so the SPA can hide nav links and buttons it knows will
 * fail — it never grants or denies access. Server-side enforcement is the
 * source of truth via `withAuth` / `requirePermission` and the API layer.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SUPER_ADMIN: [
    "users.manage",
    "roles.manage",
    "clients.view",
    "clients.manage",
    "orders.view",
    "orders.manage",
    "rto.manage",
    "agents.manage",
    "qualifications.manage",
    "pricing.manage",
    "documents.view",
    "documents.review",
    "finance.view",
    "finance.manage",
    "qb.retry",
    "qb.manage",
    "reports.view",
    "audit.view",
    "settings.manage",
    "commissions.manage",
    "commissions.view",
    "finance.reconcile",
    "rplPartners.manage",
    "rplPartners.view",
  ],
  ADMIN: [
    "users.manage",
    "roles.manage",
    "clients.view",
    "clients.manage",
    "orders.view",
    "orders.manage",
    "qualifications.manage",
    "pricing.manage",
    "documents.view",
    "documents.review",
    "finance.view",
    "finance.manage",
    "reports.view",
    "audit.view",
    "settings.manage",
    "rplPartners.manage",
    "rplPartners.view",
  ],
  BDC: [
    "clients.view",
    "clients.manage",
    "orders.view",
    "orders.manage",
    "documents.view",
    "reports.view",
  ],
  B2B_AGENT: [
    "clients.view",
    "clients.manage",
    "orders.view",
    "orders.manage",
    "documents.view",
    "reports.view",
  ],
}

export function hasPermission(
  userPermissions: Permission[],
  required: Permission,
): boolean {
  return userPermissions.includes(required)
}

/** Navigation visibility per route (mirrors server-side enforcement). */
export const ROUTE_PERMISSIONS: Record<string, Permission | null> = {
  "/dashboard": null,
  "/clients": "clients.view",
  "/orders": "orders.view",
  "/qualifications": "qualifications.manage",
  "/rtos": "qualifications.manage",
  "/agents": "qualifications.manage",
  "/pricing": "pricing.manage",
  "/documents": "documents.view",
  "/workflow": "orders.view",
  "/finance": "finance.view",
  "/reports": "reports.view",
  "/audit": "audit.view",
  "/settings": "settings.manage",
  "/users": "users.manage",
  "/roles": "roles.manage",
  "/reconciliation": "finance.manage",
  "/integrations/quickbooks": "finance.manage",
  "/rpl-partners": "rplPartners.view",
  "/certificate-deliveries": "rplPartners.view",
}

/** Default dashboard view per role. */
export const DEFAULT_VIEW_FOR: Record<RoleName, string> = {
  SUPER_ADMIN: "management",
  ADMIN: "management",
  BDC: "agent",
  B2B_AGENT: "agent",
}

/** All four role names, for UI checkbox population. */
export const ALL_ROLES: RoleName[] = ["SUPER_ADMIN", "ADMIN", "BDC", "B2B_AGENT"]
