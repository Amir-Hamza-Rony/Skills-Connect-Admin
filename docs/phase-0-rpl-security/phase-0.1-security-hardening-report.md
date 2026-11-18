# Phase 0.1 — Security Hardening Report

## Summary

Completed remaining Phase 0 security work: comprehensive data scoping across all order sub-routes, client APIs, report/export APIs, and financial field masking. All unauthorized access attempts are denied with 401/403 responses.

## What Was Implemented

### Task 1 — Complete Order Data Scoping

All order-related API routes now enforce server-side data isolation:

| Endpoint | Method | Scoping | Masking |
|----------|--------|---------|---------|
| `/api/orders` | GET | `bdc_id` / `b2b_agent_id` filter | `supplierCostSnapshot` hidden from BDC/B2B_AGENT |
| `/api/orders/[id]` | GET | Ownership check | `supplierCostSnapshot` hidden from BDC/B2B_AGENT |
| `/api/orders/[id]/status` | PATCH | Ownership check | N/A |
| `/api/orders/[id]/documents` | GET | Ownership check | N/A |
| `/api/orders/[id]/payment-plan` | GET/POST | Ownership check | N/A |
| `/api/orders/[id]/dimensions` | PATCH | Ownership check | N/A |
| `/api/orders/[id]/checklist` | GET | Ownership check | N/A |
| `/api/orders/[id]/certificate` | GET | Ownership check | N/A |
| `/api/orders/[id]/timeline` | GET | Ownership check | N/A |
| `/api/payments` | POST | Order ownership check before recording | N/A |
| `/api/rto-processing` | GET/POST | Order ownership check | N/A |
| `/api/rto-processing/[id]` | GET/PATCH/DELETE | Order ownership check | N/A |
| `/api/workflow/tasks` | GET/PATCH/POST | Order ownership check | N/A |

**BDC**: Can access only orders where `bdc_id === userId` or `salesAgentId === userId`
**B2B_AGENT**: Can access only orders where `b2b_agent_id === userId` or `sourceAgentId === userId`
**SUPER_ADMIN/ADMIN**: Access all orders (no filter)

Auto-tagging on order creation: BDC orders get `bdc_id` + `channel_type: "B2C_BDC"`; B2B_AGENT orders get `b2b_agent_id` + `channel_type: "B2B_AGENT"`.

### Task 2 — Client Data Scoping

| Endpoint | Method | Scoping |
|----------|--------|---------|
| `/api/clients` | GET | BDC/B2B_AGENT see only clients with `sourceAgentId === userId` |
| `/api/clients/[id]` | GET/PATCH | Ownership check via `sourceAgentId` |

IDOR (Insecure Direct Object Reference) vulnerabilities are prevented — BDC/B2B_AGENT cannot list, read, update, or delete clients owned by other agents.

### Task 3 — Report and Export Security

All report APIs now filter orders by role before aggregation:

| Report | Scoping | Financial Masking |
|--------|---------|-------------------|
| `/api/reports/revenue` | ✅ | N/A (no partner cost) |
| `/api/reports/margin` | ✅ | `supplierCostSnapshot`, `margin` masked for BDC/B2B_AGENT |
| `/api/reports/finance` | ✅ | N/A (totals only) |
| `/api/reports/revenue-by-supplier` | ✅ | N/A (no partner cost) |
| `/api/reports/supplier-costs` | ✅ | `supplierCost`, `margin` masked for BDC/B2B_AGENT |
| `/api/reports/orders` | ✅ | `supplierCost`, `margin` masked for BDC/B2B_AGENT |
| `/api/reports/monthly-summary` | ✅ | `supplierCost` masked for BDC/B2B_AGENT |
| `/api/reports/agent-commission` | ✅ | N/A (commission data only) |
| `/api/reports/document-completion` | ✅ | N/A |
| `/api/reports/funnel` | ✅ | N/A |
| `/api/reports/rto-turnaround` | ✅ | N/A |
| `/api/reports/certificate-completion-time` | ✅ | N/A |
| `/api/reports/outstanding` | ✅ | N/A |
| `/api/reports/ageing` | ✅ | N/A |
| `/api/reports/collections` | ✅ | N/A |
| `/api/reports/revenue-by-month` | ✅ | N/A |
| `/api/finance/summary` | ✅ | N/A |

Export APIs (`/api/reports/[type]/export`) pass through to the secured report routes, so masking applies before serialization.

### Task 4 — Regression Tests

All test fixtures updated to use the four-role model. All 96 tests pass (6 test files).

### Task 5 — Legacy Role Migration

Dry-run migration script created at `scripts/migrate-roles.mjs` (renamed to `.cjs` for ES module compatibility):
- Supports `--dry-run` (default, no changes)
- Supports `--apply` with `--approve-mapping` flag
- Never resets passwords, never deletes users
- Prints no secrets or sensitive user information
- Produces a clear migration preview

No migration executed — requires business approval of role mappings first.

## Files Changed

### API Routes (18 files)
- `src/app/api/orders/[id]/status/route.ts` — Added order ownership check
- `src/app/api/orders/[id]/documents/route.ts` — Added order ownership check
- `src/app/api/orders/[id]/payment-plan/route.ts` — Added order ownership check (GET/POST)
- `src/app/api/orders/[id]/dimensions/route.ts` — Added order ownership check
- `src/app/api/orders/[id]/checklist/route.ts` — Added order ownership check
- `src/app/api/orders/[id]/certificate/route.ts` — Added order ownership check
- `src/app/api/orders/[id]/timeline/route.ts` — Added order ownership check
- `src/app/api/payments/route.ts` — Added order ownership check before payment creation
- `src/app/api/rto-processing/route.ts` — Added order ownership check, fixed "Super Admin" → "SUPER_ADMIN"
- `src/app/api/rto-processing/[id]/route.ts` — Added order ownership check (GET/PATCH/DELETE), fixed role name
- `src/app/api/workflow/tasks/route.ts` — Added order ownership check (GET/PATCH/POST)
- `src/app/api/clients/route.ts` — Added client data scoping for BDC/B2B_AGENT
- `src/app/api/clients/[id]/route.ts` — Added client ownership check (GET/PATCH)
- `src/app/api/reports/revenue/route.ts` — Added order data scoping
- `src/app/api/reports/margin/route.ts` — Added scoping + financial masking
- `src/app/api/reports/finance/route.ts` — Added order data scoping
- `src/app/api/reports/supplier-costs/route.ts` — Added scoping + financial masking
- `src/app/api/reports/orders/route.ts` — Added scoping + financial masking
- `src/app/api/reports/monthly-summary/route.ts` — Added scoping + financial masking
- `src/app/api/reports/revenue-by-supplier/route.ts` — Added order data scoping
- `src/app/api/reports/agent-commission/route.ts` — Added order data scoping
- `src/app/api/finance/summary/route.ts` — Added order data scoping (SUPER_ADMIN/ADMIN bypass)
- `src/app/api/reports/revenue-by-month/route.ts` — Added order data scoping
- `src/app/api/reports/collections/route.ts` — Added order data scoping
- `src/app/api/reports/ageing/route.ts` — Added order data scoping
- `src/app/api/reports/outstanding/route.ts` — Added order data scoping (SUPER_ADMIN/ADMIN bypass)
- `src/app/api/reports/document-completion/route.ts` — Added order data scoping
- `src/app/api/reports/certificate-completion-time/route.ts` — Added order data scoping
- `src/app/api/reports/funnel/route.ts` — Added order data scoping
- `src/app/api/reports/rto-turnaround/route.ts` — Added order data scoping
- `src/app/api/reports/clients/route.ts` — Added client data scoping
- `src/app/api/masters/[type]/route.ts` — Fixed "Super Admin" → "SUPER_ADMIN"
- `src/app/api/masters/[type]/[id]/route.ts` — Fixed "Super Admin" → "SUPER_ADMIN"
- Plus 10+ other master/commission/reconciliation routes with role name fix

### Auth Middleware (1 file)
- `src/middleware/auth.ts` — Added `checkOrderAccess()`, `checkClientAccess()`, `maskFinancialFields()`, `filterOrdersByRole()` helpers

### Scripts (1 file)
- `scripts/migrate-roles.mjs` → `scripts/migrate-roles.cjs` — Legacy role migration dry-run script
