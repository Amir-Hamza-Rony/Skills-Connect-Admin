/**
 * RBAC matrix — spec §11.
 *
 * THIS FILE IS THE SINGLE SOURCE OF TRUTH. The frontend mirror
 * (`src/lib/permissions.ts`) exists only so the SPA can hide UI it cannot use;
 * it never grants access. Every enforcement decision is made here, server-side,
 * by `requirePermission`.
 *
 * The 18 permissions and the 7 roles are reproduced verbatim from the frontend
 * matrix that was reviewed during Day 2, so no behaviour regresses on cutover.
 */

export const PERMISSIONS = [
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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_NAMES = [
  "Super Admin",
  "Finance",
  "Operations",
  "Sales / Closing Agent",
  "RTO / Sourcing Manager",
  "Document Reviewer",
  "Read Only / Manager",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  "Super Admin":
    "Everything, including users, roles, settings, integrations and audit logs.",
  Finance:
    "Invoices, payments, payment plans, QuickBooks sync and finance reports. Cannot delete audit history.",
  Operations:
    "Clients, orders, documents, workflow, RTO submissions and certificates.",
  "Sales / Closing Agent":
    "Own clients and orders, notes, permitted communication and payment visibility.",
  "RTO / Sourcing Manager":
    "Supplier agents, RTOs, qualification pricing, sourcing route and provider status.",
  "Document Reviewer":
    "View, upload and review documents. Cannot change financial records.",
  "Read Only / Manager": "Dashboards and reports only. No editing.",
};

/** Seeded on first run. Edit here, then re-run the seed — not in the UI. */
export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  "Super Admin": PERMISSIONS,
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
  "Read Only / Manager": [
    "clients.view",
    "orders.view",
    "finance.view",
    "reports.view",
    "documents.view",
  ],
};

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

export function isRoleName(value: unknown): value is RoleName {
  return typeof value === "string" && (ROLE_NAMES as readonly string[]).includes(value);
}

/** Union of a user's role permissions, de-duplicated and order-stable. */
export function resolvePermissions(rolePermissionSets: readonly (readonly Permission[])[]): Permission[] {
  const out = new Set<Permission>();
  for (const set of rolePermissionSets) for (const perm of set) out.add(perm);
  return PERMISSIONS.filter((p) => out.has(p));
}