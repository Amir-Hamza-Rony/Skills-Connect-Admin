import type { Permission, RoleName } from "@/lib/types"

/**
 * Role → portal mapping (docs v5.1 §1, v5.0 §1).
 *
 * 6 roles: SUPER_ADMIN, OPS_ADMIN, ACCOUNTS, SALES_BDC, EXTERNAL_BROKER, CANDIDATE
 * 5 portals: /admin, /ops, /sales, /partner, /applicant
 */
export const ROLE_PORTAL: Record<RoleName, string> = {
  SUPER_ADMIN: "/admin",
  OPS_ADMIN: "/ops",
  ACCOUNTS: "/ops",
  SALES_BDC: "/sales",
  EXTERNAL_BROKER: "/partner",
  CANDIDATE: "/applicant",
  ADMIN: "/admin",
  BDC: "/sales",
  B2B_AGENT: "/partner",
  EMPLOYEE: "/ops",
}

/**
 * RBAC matrix — docs require backend enforcement via withAuth / requirePermission.
 * This copy drives nav visibility only; never grants access.
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
    "scopes.manage",
  ],
  OPS_ADMIN: [
    "orders.view",
    "orders.manage",
    "documents.view",
    "documents.review",
    "qualifications.manage",
    "rto.manage",
    "reports.view",
    "audit.view",
    "scopes.manage",
  ],
  ACCOUNTS: [
    "finance.view",
    "finance.manage",
    "qb.retry",
    "qb.manage",
    "reports.view",
    "orders.view",
    "documents.view",
    "commissions.view",
  ],
  SALES_BDC: [
    "clients.view",
    "clients.manage",
    "orders.view",
    "orders.manage",
    "documents.view",
    "reports.view",
    "commissions.view",
  ],
  EXTERNAL_BROKER: [
    "clients.view",
    "clients.manage",
    "orders.view",
    "documents.view",
    "reports.view",
  ],
  CANDIDATE: [
    "clients.view",
    "documents.view",
    "orders.view",
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
    "documents.view",
    "reports.view",
  ],
  EMPLOYEE: [
    "clients.view",
    "orders.view",
    "documents.view",
  ],
}

/** Full canonical permission set. */
export const ALL_PERMISSIONS: Permission[] = [
  ...new Set([
    ...ROLE_PERMISSIONS.SUPER_ADMIN,
    ...ROLE_PERMISSIONS.OPS_ADMIN,
    ...ROLE_PERMISSIONS.ACCOUNTS,
    ...ROLE_PERMISSIONS.SALES_BDC,
    ...ROLE_PERMISSIONS.EXTERNAL_BROKER,
    ...ROLE_PERMISSIONS.CANDIDATE,
  ]),
]

export function hasPermission(
  userPermissions: Permission[],
  required: Permission,
): boolean {
  return userPermissions.includes(required)
}

/** Navigation visibility per route (mirrors server-side enforcement). */
export const ROUTE_PERMISSIONS: Record<string, Permission | null> = {
  "/dashboard": null,
  "/admin": null,
  "/ops": null,
  "/sales": null,
  "/partner": null,
  "/applicant": null,
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
  "/scopes": "scopes.manage",
  "/qualifications/:id/scopes": "scopes.manage",
  // Phase 5: new canonical paths
  "/candidates": "clients.view",
  "/enrolments": "orders.view",
  "/provider/qualifications": "qualifications.manage",
  "/provider/scopes": "scopes.manage",
  "/provider/enrolment-kits": "scopes.manage",
  "/provider/rtos": "rto.manage",
  "/provider/rpl-partners": "rplPartners.view",
  "/sales/agents": "agents.manage",
  "/partner/external-agents": "clients.view",
  "/pricing/pricing": "pricing.manage",
  "/pricing/categories": "pricing.manage",
  "/pricing/lists": "pricing.manage",
  "/pricing/fees": "pricing.manage",
  "/finance/finance": "finance.view",
  "/finance/commission-rules": "commissions.manage",
  "/finance/commission-records": "commissions.manage",
  "/finance/commission-payouts": "commissions.manage",
  "/finance/bdc-commission-ledger": "commissions.view",
  "/settings/reports": "reports.view",
  "/settings/audit": "audit.view",
  "/settings/users": "users.manage",
  "/settings/roles": "roles.manage",
  "/settings/settings": "settings.manage",
  "/settings/quickbooks": "qb.manage",
  "/settings/reconciliation": "finance.reconcile",
}

/** Default dashboard view per role. */
export const DEFAULT_VIEW_FOR: Record<RoleName, string> = {
  SUPER_ADMIN: "management",
  OPS_ADMIN: "operations",
  ACCOUNTS: "finance",
  SALES_BDC: "agent",
  EXTERNAL_BROKER: "b2b",
  CANDIDATE: "applicant",
  ADMIN: "management",
  BDC: "agent",
  B2B_AGENT: "b2b",
  EMPLOYEE: "employee",
}

/** All role names, for UI checkbox population. */
export const ALL_ROLES: RoleName[] = [
  "SUPER_ADMIN",
  "OPS_ADMIN",
  "ACCOUNTS",
  "SALES_BDC",
  "EXTERNAL_BROKER",
  "CANDIDATE",
  "ADMIN",
  "BDC",
  "B2B_AGENT",
  "EMPLOYEE",
]

/**
 * Resolve the primary role that drives dashboard scoping and display.
 * Priority follows ALL_ROLES. Legacy role is a fallback.
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