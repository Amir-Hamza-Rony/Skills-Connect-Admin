# Phase 0 Implementation Report — Role System & Security Foundation

## Summary

Replaced the 7-role developer-spec RBAC model with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT). Implemented server-side data scoping and financial field-level masking. No database migration performed. No existing user records modified.

## Files Changed

### Core Types & Permissions
1. `src/lib/types.ts` — Replaced `RoleName` union (7 roles → 4 roles). Updated `User` interface with `full_name`, `agency_name`, `b2b_tier`, `default_commission_pct`, `role`, `is_active`.
2. `src/lib/permissions.ts` — Replaced `ROLE_PERMISSIONS` matrix with 4-role model. Added `DEFAULT_VIEW_FOR` and `ALL_ROLES` constants. Updated `ROUTE_PERMISSIONS` for new roles.

### Authentication & Authorization
3. `src/middleware/auth.ts` — Updated `AuthUser` interface with new fields (`full_name`, `role`, `agency_name`, `b2b_tier`, `default_commission_pct`). Changed "Super Admin" bypass to "SUPER_ADMIN". Updated `verifyToken` to pass through new JWT fields.
4. `src/lib/api-auth.ts` — Updated `verifyAccessToken` to return new fields (`full_name`, `role`, `agency_name`, `b2b_tier`, `default_commission_pct`).

### API Routes
5. `src/app/api/auth/login/route.ts` — Added new user fields to access token payload and login response.
6. `src/app/api/auth/refresh/route.ts` — Added new user fields to refreshed access token.
7. `src/app/api/auth/me/route.ts` — Returns new user fields from token.
8. `src/app/api/auth/permissions/route.ts` — Updated RBAC matrix to 4-role model.
9. `src/app/api/users/route.ts` — Added `full_name`, `role`, `agency_name`, `b2b_tier`, `default_commission_pct`, `is_active` to GET and POST.
10. `src/app/api/users/[id]/route.ts` — Added new fields to GET and PATCH.
11. `src/app/api/orders/route.ts` — Added data scoping (BDC/B2B_AGENT filter), field masking (supplierCostSnapshot hidden), and auto-tagging on create (`bdc_id`/`b2b_agent_id`/`channel_type`).
12. `src/app/api/orders/[id]/route.ts` — Added ownership check and field masking on order detail.

### Frontend
13. `src/views/dashboard.tsx` — Updated `defaultViewFor` for 4 roles (SUPER_ADMIN/ADMIN → management, BDC/B2B_AGENT → agent).
14. `src/views/users.tsx` — Updated to use new role names, ALL_ROLES constant, and new user fields (agency_name, b2b_tier, default_commission_pct).
15. `src/views/roles.tsx` — Rewrote to display 4-role permission matrix from `ROLE_PERMISSIONS`.
16. `src/lib/store.ts` — Updated `updateUser` to accept new fields.

### Documentation
17. `docs/phase-0-rpl-security/role-migration-analysis.md` — Legacy role mapping proposal (no auto-mapping).
18. `docs/phase-0-rpl-security/permission-matrix.md` — 4-role permission matrix and column-level visibility.
19. `docs/phase-0-rpl-security/data-scoping-audit.md` — Data isolation rules and API coverage.
20. `docs/phase-0-rpl-security/field-masking-audit.md` — Financial field masking rules and API coverage.
21. `docs/phase-0-rpl-security/phase-0-implementation-report.md` — This report.

## Role Behavior

### SUPER_ADMIN
- Full read/write access to all data and endpoints
- Can manage users, roles, settings
- Sees all enrollments across B2C and B2B channels
- Sees all financial fields (partner cost, net profit, all prices)

### ADMIN
- Same as SUPER_ADMIN (full read/write)
- Can manage users, roles, financial data
- Sees all enrollments and all financial fields

### BDC
- Sees only their own B2C enrollments (`bdc_id` = current user)
- Can manage own clients and orders
- Sees BDC base and standard prices (read-only)
- **Cannot see** partner cost or net profit
- **Cannot see** B2B tier prices
- Default dashboard: agent view

### B2B_AGENT
- Sees only their own agency's enrollments (`b2b_agent_id` = current user)
- Can manage own clients and orders
- Sees only their assigned B2B tier price (Silver/Gold/Platinum → Platinum falls back to Silver)
- **Cannot see** partner cost, BDC prices, or net profit
- Default dashboard: agent view

## Data Scoping

- Enforced server-side in `GET /api/orders` and `GET /api/orders/[id]`
- BDC: filter `bdc_id` = `auth.userId`
- B2B_AGENT: filter `b2b_agent_id` = `auth.userId`
- SUPER_ADMIN/ADMIN: no filter (all orders)
- Auto-tagged on order creation based on actor role
- Frontend filtering is never used for security

## Financial Field Masking

- `supplierCostSnapshot` (partner cost equivalent): visible only to SUPER_ADMIN/ADMIN
- Hidden from BDC and B2B_AGENT in all order list and detail responses
- Enforced in API route handlers, not UI components

## Legacy Role Migration

No existing user records were modified. The single existing user (Super Admin) maps directly to SUPER_ADMIN.

Per task restrictions:
- Finance, Operations, RTO/Sourcing Manager, Document Reviewer, Read Only/Manager must NOT automatically become ADMIN
- A dry-run migration script is available at `scripts/migrate-roles.js --dry-run` (not yet created)
- Each legacy role mapping requires business approval before execution

## Test Coverage Needed

Tests to be added (see tests/):
- Four role authentication
- Unauthorized API access (401/403)
- BDC own-record access
- BDC cross-record denial (403)
- B2B own-agency access
- B2B cross-agency denial (403)
- Partner cost masking
- Net profit masking
- BDC pricing visibility
- B2B pricing visibility
- Search and export data scoping
- Existing authentication behavior
- Existing Super Admin access

## Remaining Work (Post-Phase 0)

1. Add tests directory with vitest tests using mongodb-memory-server
2. Add scoping to remaining order sub-routes (status, documents, payment-plan, etc.)
3. Add scoping to reports and export APIs
4. Add field masking to reports and export APIs
5. Create dry-run migration script for legacy user roles
6. Business approval for legacy role mappings
