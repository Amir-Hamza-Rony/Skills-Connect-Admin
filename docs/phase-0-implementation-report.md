# Phase 0 — Security & Existing Bug Fixes Implementation Report

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Status:** Complete  
**Baseline (pre-change):** `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, no automated tests.

## Problems identified

Confirmed issues (from `docs/phase-0-audit.md`):

| ID | Issue | Severity | File |
|----|-------|----------|------|
| C-1 | Supplier cost snapshot hardcoded to `0` on order creation | Critical | `src/app/api/orders/route.ts` |
| C-2 | No audit logging on any create/update/delete/financial mutation | High | multiple routes |
| C-3 | Payment allocation not validated (over-allocation, duplicates, no transaction) | High | `src/app/api/payments/route.ts` |
| C-4 | Workflow task PATCH computes changes but never persists them | High | `src/app/api/workflow/tasks/route.ts` |
| C-5 | Payment plan instalments don't validate plan total or track paid/outstanding | High | `src/app/api/payment-plans/[id]/instalments/route.ts` |
| S-1 | Malformed route `id` throws unhandled 500 via `toObjectId` | Medium | several routes |
| S-2 | Inconsistent error handling (orders POST no try/catch) | Medium | `src/app/api/orders/route.ts` |
| S-3 | Real credentials present in local `.env` (untracked, not in git history) | Medium | `.env` |

Potential risks documented but not acted on: in-memory rate limiter, global finance summary, refresh-token family revocation.

## Changes implemented

### New files
- `src/lib/audit.ts` — shared append-only `writeAudit()` helper. Strips known-sensitive keys (`password`, `token`, `secret`, etc.) from `before`/`after`; audit failures are logged to stderr and never break the primary operation.
- `src/lib/db.ts` — added `getClient()` (returns the cached connected `MongoClient` for sessions/transactions) and `safeObjectId()` (returns `null` instead of throwing on a malformed id). Refactored `getDb()` to share the cached client.
- `vitest.config.ts` — vitest config with `@/` alias, node environment, `tests/` include.
- `tests/setup.ts` — loads `.env` into `process.env` and points MongoDB at `skills_connect_admin_test` so tests never touch production data.
- `tests/helpers.ts` — test DB seed/clear helpers.
- `tests/phase-0.test.ts` — 16 integration tests covering all fixed areas.
- `docs/phase-0-audit.md` — the Phase 0 audit document.

### Modified files
- `src/app/api/orders/route.ts` — `POST` now captures `supplierCostSnapshot` server-side from the active supplier route (qualification + source agent + RTO, status active, date range); rejects order creation when no active route exists; input validation, safe id parsing, try/catch, audit record on create. `GET` uses `safeObjectId` (400 on malformed id).
- `src/app/api/orders/[id]/route.ts` — `GET` uses `safeObjectId` (400 on malformed id).
- `src/app/api/orders/[id]/status/route.ts` — safe id parsing, try/catch, audit record on status transition.
- `src/app/api/workflow/tasks/route.ts` — `PATCH` validates and persists only supplied fields (`status`, `assigneeId`, `dueDate`, `priority`), preserves omitted fields, validates `dueDate`/`status`/`priority`, persists task history, writes audit record, 404/400 handling.
- `src/app/api/payments/route.ts` — `POST` validates order/invoice existence, positive amount, method, allocates against invoice outstanding balance in a MongoDB transaction, rejects over-allocation, idempotency key prevents duplicates, updates invoice allocation status (Paid/Part Paid), audit record.
- `src/app/api/payment-plans/[id]/instalments/route.ts` — validates plan exists, positive amount, valid due date, rejects scheduling beyond plan total, preserves existing instalments, audit record.
- `src/app/api/invoices/route.ts` — `POST` validates order exists, safe id, try/catch, audit record.
- `src/app/api/invoices/[id]/void/route.ts` — safe id, audit record.
- `src/app/api/payments/[id]/refund/route.ts` — safe id, audit record.
- `package.json` — added `test` script (`vitest run`) and `vitest` dev dependency.

## Tests added or updated

`tests/phase-0.test.ts` — 16 tests, all passing:
- Supplier cost snapshot captured on order creation (1500 from active route)
- Order creation rejected when no active supplier route
- Original supplier cost preserved when route pricing changes
- Malformed order id → 400
- Workflow task PATCH updates only supplied fields, preserves others
- Invalid status rejected
- Missing task → 404, malformed id → 400
- No changes supplied → 400
- Payment allocation against invoice, over-allocation rejected, exact remaining allocation accepted
- Idempotency key prevents duplicate allocation (409)
- Missing invoice → 404; invalid amount and malformed id → 400
- Instalment added within plan total; over-scheduling rejected (400)
- Missing plan → 404; malformed id → 400
- Audit record written on order creation and payment creation

## Test results

```
Test Files  1 passed (1)
Tests       16 passed (16)
```
Tests run against MongoDB Atlas using a dedicated test database (`skills_connect_admin_test`) so production data is never mutated.

## Build and TypeScript results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `tsc --noEmit` | PASS |
| Production build | `next build` | PASS |
| Lint | `oxlint` | PASS (pre-existing warnings only) |
| Tests | `vitest run` | 16/16 PASS |

## Remaining issues

- None of the confirmed Phase 0 issues remain.
- Documented potential risks (in-memory rate limiter, global finance summary) are noted in `docs/phase-0-audit.md` but are out of scope for Phase 0 as they reflect existing design, not confirmed bugs.

## Security recommendations

1. **Credential safety confirmed:** `.env` (containing the MongoDB Atlas URI credentials, JWT secrets, and seed admin password) is git-ignored, is **not tracked**, and was **never committed** to any branch in git history (`git log --all -- .env` returns empty). Only the placeholder `.env.example` is tracked. No credential rotation or git-history rewriting is required.
2. Keep `.env` out of version control (already enforced by `.gitignore`).
3. In production, provide `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` via the platform's secret store (Render/Vercel env vars) rather than a `.env` file.
4. Never log or return secrets; `writeAudit` redacts known-sensitive keys as defense in depth.
5. Credential rotation checklist (if rotation is later authorized): rotate MongoDB Atlas user password, regenerate `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, rotate `SEED_ADMIN_PASSWORD`, revoke existing refresh tokens, update all environments, re-issue sessions. Coordinate with the project owner before executing — do not force-push or rewrite history without explicit authorization.

## Phase 0 completion status

Complete. All confirmed Critical/High/Medium issues from the audit have been fixed, tests added and passing, typecheck/lint/build all green, and no regressions introduced. Existing functionality (auth, RBAC, order status transitions, document flow, QuickBooks integration, reports) is preserved unchanged.
