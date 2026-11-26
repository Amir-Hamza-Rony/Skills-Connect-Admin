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
    "rto.manage",
    "agents.manage",
    "qualifications.manage",
    "pricing.manage",
    "documents.view",
    "documents.review",
    "finance.view",
    "finance.manage",
    "commissions.view",
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
  EMPLOYEE: [
    "clients.view",
    "orders.view",
    "documents.view",
  ],
}

/**
 * Full canonical permission set. SUPER_ADMIN holds every key, so this is the
 * single source of truth for secondary consumers (permission API, role edit
 * whitelist). Do not duplicate the list in those call sites.
 */
export const ALL_PERMISSIONS: Permission[] = [...ROLE_PERMISSIONS.SUPER_ADMIN]

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
  "/rtos": "rto.manage",
  "/agents": "agents.manage",
  "/pricing": "pricing.manage",
  "/price-categories": "pricing.manage",
  "/price-lists": "pricing.manage",
  "/additional-fees": "pricing.manage",
  "/qualification-rto-mappings": "qualifications.manage",
  "/documents": "documents.view",
  "/workflow": "orders.view",
  "/finance": "finance.view",
  "/commission-rules": "commissions.manage",
  "/commission-records": "commissions.manage",
  "/commission-payouts": "commissions.manage",
  "/reports": "reports.view",
  "/audit": "audit.view",
  "/settings": "settings.manage",
  "/users": "users.manage",
  "/roles": "roles.manage",
  "/reconciliation": "finance.reconcile",
  "/integrations/quickbooks": "qb.manage",
  "/rpl-partners": "rplPartners.view",
  "/certificate-deliveries": "rplPartners.view",
  "/rto-processing": "rto.manage",
  "/excel/templates": "finance.manage",
  "/excel/upload": "finance.manage",
  "/excel/imports": "finance.manage",
  "/excel/bulk-students": "finance.manage",
  "/price-matrix-import": "pricing.manage",
  "/excel/import-master-hub": "rto.manage",
  "/excel/bulk-rtos": "rto.manage",
  "/excel/bulk-quals": "qualifications.manage",
  "/excel/bulk-mappings": "qualifications.manage",
}

/** Default dashboard view per role. */
export const DEFAULT_VIEW_FOR: Record<RoleName, string> = {
  SUPER_ADMIN: "management",
  ADMIN: "management",
  BDC: "agent",
  B2B_AGENT: "b2b",
  EMPLOYEE: "employee",
}

/** All five role names, for UI checkbox population. */
export const ALL_ROLES: RoleName[] = ["SUPER_ADMIN", "ADMIN", "BDC", "B2B_AGENT", "EMPLOYEE"]

/**
 * Resolve the single role that drives dashboard scoping and display.
 *
 * `roleNames` is the authoritative list written from the user document at
 * login/refresh. The legacy `role` field can be stale (for example an ADMIN or
 * B2B_AGENT account that still carries `role: "BDC"`), so it is only a fallback
 * when no canonical role name is present. Priority follows ALL_ROLES, which is
 * also the order used by the dashboard UI, keeping server and client in sync.
 *
 * Unknown/non-canonical strings are intentionally ignored here rather than
 * guessed at: permission enforcement continues to use the exact values in the
 * signed token, so this helper never grants access on its own.
 */
export function resolvePrimaryRole(input: {
  role?: string | null;
  roleNames?: readonly string[] | null;
}): RoleName | null {
  const names = Array.isArray(input.roleNames) ? input.roleNames : [];
  for (const role of ALL_ROLES) {
    if (names.includes(role)) return role;
  }
  const legacyRole = input.role;
  if (legacyRole && (ALL_ROLES as readonly string[]).includes(legacyRole)) {
    return legacyRole as RoleName;
  }
  return null;
}
