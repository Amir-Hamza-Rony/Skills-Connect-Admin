import type { Permission, RoleName } from "@/lib/types"

/**
 * RBAC matrix — Spec §11 roles mapped to granular permissions.
 * IMPORTANT: UI guards mirror this matrix for UX only. The future backend
 * MUST re-enforce every permission server-side; frontend hiding alone
 * never grants or denies access.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  "Super Admin": [
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
    "reports.view",
    "audit.view",
    "settings.manage",
  ],
  Finance: [
    "clients.view",
    "orders.view",
    "finance.view",
    "finance.manage",
    "qb.retry",
    "reports.view",
    "documents.view",
  ],
  Operations: [
    "clients.view",
    "clients.manage",
    "orders.view",
    "orders.manage",
    "documents.view",
    "documents.review",
    "reports.view",
  ],
  "Sales / Closing Agent": ["clients.view", "orders.view", "finance.view", "reports.view"],
  "RTO / Sourcing Manager": [
    "rto.manage",
    "agents.manage",
    "qualifications.manage",
    "pricing.manage",
    "orders.view",
    "reports.view",
  ],
  "Document Reviewer": ["clients.view", "orders.view", "documents.view", "documents.review"],
  "Read Only / Manager": ["clients.view", "orders.view", "finance.view", "reports.view", "documents.view"],
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
  "/rtos": "rto.manage",
  "/agents": "agents.manage",
  "/pricing": "pricing.manage",
  "/documents": "documents.view",
  "/workflow": "orders.view",
  "/finance": "finance.view",
  "/reports": "reports.view",
  "/audit": "audit.view",
  "/settings": "settings.manage",
  "/users": "users.manage",
  "/roles": "roles.manage",
}
