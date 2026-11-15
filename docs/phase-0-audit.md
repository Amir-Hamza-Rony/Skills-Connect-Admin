# Phase 0 — Security & Existing Bug Fixes Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Architecture:** Next.js App Router + TypeScript, MongoDB Atlas (`skills_connect_admin`)  
**Audit date:** 2026-11-03  
**Baseline:** `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS (warnings only), no automated tests exist.

## Scope reviewed

Authentication & authorization, RBAC, env handling, DB connection/collection access, API routes & validation, supplier routes & cost handling, workflow tasks & status updates, payment allocation, payment plans, audit logging, existing tests, TypeScript config & production build.

## Credential safety (confirmed)

- `.env` contains real production credentials (MongoDB Atlas URI with username/password, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_ADMIN_PASSWORD`).
- `.env` is git-ignored (`\.env`, `\.env.*`), is **not tracked** (`git ls-files` shows no `.env`), and was **never committed** to any branch in git history (`git log --all -- .env` returns nothing). Only the placeholder `.env.example` is tracked.
- **No credential rotation or git-history rewriting is required.** A rotation checklist is provided in the Security recommendations section.

---

## Confirmed issues

### C-1 — Supplier cost snapshot not captured (CRITICAL)

**Affected file:** `src/app/api/orders/route.ts:64`  
**Business impact:** Every order is created with `supplierCostSnapshot: 0`, so gross margin (`sellingPrice - supplierCostSnapshot - otherCost`) is always overstated and supplier-cost financials are wrong. Historical order cost is not preserved because it was never captured.

**Technical cause:** `POST /api/orders` never queries the `supplier-routes` collection. The comment in `src/lib/ops-store.ts:68` claims the snapshot is taken server-side from the active supplier route, but the implementation hardcodes `0`.

**Recommended solution:** In `POST /api/orders`, look up the active supplier route matching `qualificationId` + `sourceAgentId` + `rtoId` (status `active`, `effectiveFrom` <= now, `effectiveTo` null or >= now) and snapshot its `wholesaleCost` into `supplierCostSnapshot`. If no active route exists, reject with a clear error rather than silently writing 0. Do not allow the client to send a supplier cost.

**Priority:** Critical  
**Verification method:** Test that creating an order snapshots the active route's wholesale cost; test that a subsequent supplier route price change/expiry does not alter an existing order's `supplierCostSnapshot`; test that creating an order with no active route returns an error.

### C-2 — No audit logging on any mutation (HIGH)

**Affected files:** `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/status/route.ts`, `src/app/api/payments/route.ts`, `src/app/api/payments/[id]/refund/route.ts`, `src/app/api/invoices/route.ts`, `src/app/api/invoices/[id]/void/route.ts`, `src/app/api/payment-plans/[id]/instalments/route.ts`, `src/app/api/workflow/tasks/route.ts`

**Business impact:** `GET /api/audit` exists and is permission-gated (`audit.view`), but nothing writes to the `audit_logs` collection. There is no traceability of create/update/delete/financial actions, no actor capture, and no compliance record for money movements.

**Technical cause:** Mutation handlers perform DB writes but never insert an audit record. No shared audit-write helper exists.

**Recommended solution:** Add a shared `writeAudit({ actorId, actorEmail, entityType, entityId, action, before, after })` helper (in a new `src/lib/audit.ts`) that inserts into `audit_logs` with `createdAt`. Call it from every mutation handler, capturing `req.auth.userId`/`email`. Audit failures must not break the primary operation (log and continue), but must be surfaced. Never store passwords/tokens in `before`/`after`.

**Priority:** High  
**Verification method:** Test that creating an order, transitioning status, recording a payment, refunding, voiding an invoice, and adding an instalment each produce an audit row with actor, action, entity, timestamp, and before/after.

### C-3 — Payment allocation not validated (HIGH)

**Affected file:** `src/app/api/payments/route.ts:26-45`

**Business impact:** `POST /api/payments` always sets `allocatedAmount: amount` and `status: "Allocated"` regardless of the invoice's outstanding balance. Payments can over-allocate, be duplicated, or be recorded against a non-existent invoice, corrupting outstanding balances and finance summary.

**Technical cause:** No validation that the invoice exists, no check that `amount <= outstanding`, no duplicate-prevention (idempotency), no transaction tying payment + allocation together.

**Recommended solution:** Validate `orderId`/`invoiceId` references exist; reject non-positive amounts; compute the invoice's outstanding balance (total minus already-allocated payments) and reject allocations exceeding it; mark payment status as `Allocated`/`Partially Allocated` accordingly; wrap payment insert + allocation update in a MongoDB transaction/session where supported; add idempotency key support to prevent duplicate allocations.

**Priority:** High  
**Verification method:** Test that over-allocating against an invoice is rejected, that duplicate payments are prevented, that outstanding balance decreases correctly, and that allocating to a missing invoice returns 404.

### C-4 — Workflow task PATCH does not persist changes / history (HIGH)

**Affected file:** `src/app/api/workflow/tasks/route.ts:49-89`

**Business impact:** `PATCH /api/workflow/tasks/[id]` computes a `changes` array but never writes it anywhere — no task history, no audit record. `src/lib/ops-store.ts:202` (`updateTaskStatus`) only ever sends `{ status }`, so callers cannot update assignee/dueDate/priority through the store even though the route accepts them. Invalid `dueDate` strings can produce `Invalid Date` values silently.

**Technical cause:** The `changes` accumulator is built but discarded; no history array is maintained on the task document; no validation of `dueDate` parse result.

**Recommended solution:** Validate and persist only the fields provided (`status`, `assigneeId`, `dueDate`, `priority`), preserving all others. Validate `dueDate` parses to a valid date. Append a history entry to the task document and write an audit record. Return the updated task. `updateTaskStatus` store helper can remain status-only (backward compatible); the route now supports the full field set.

**Priority:** High  
**Verification method:** Test updating each field individually and in combination; test that omitted fields are preserved; test invalid status/dueDate are rejected; test missing task returns 404; test audit row is written.

### C-5 — Payment plan instalments break paid/outstanding consistency (HIGH)

**Affected file:** `src/app/api/payment-plans/[id]/instalments/route.ts:20-70`

**Business impact:** `POST .../instalments` only `$push`es the instalment and bumps `updatedAt`. It never updates the plan's paid/outstanding totals, never validates that cumulative instalments stay within the plan `total`, and never marks instalments as paid when a payment is allocated. Financial records become inconsistent.

**Technical cause:** No validation of `amount` against remaining plan balance, no paid-amount tracking, no link between payments and instalments.

**Recommended solution:** Validate `amount` is positive and that the new cumulative instalment total does not exceed the plan `total`. Track `paidAmount` per instalment and recompute plan outstanding (`total - sum(paidAmount)`). Preserve existing instalment history. Add audit record.

**Priority:** High  
**Verification method:** Test that adding instalments within the plan total succeeds, that exceeding it is rejected, and that outstanding is recomputed correctly.

### S-1 — Invalid route ID causes unhandled 500 (MEDIUM)

**Affected files:** `src/app/api/orders/[id]/route.ts:14`, `src/app/api/workflow/tasks/route.ts:56`, and other handlers calling `toObjectId(id)` without a try/catch.

**Business impact:** A malformed `id` throws from `new ObjectId(...)`, producing an unhandled 500 instead of a clean 400/404.

**Technical cause:** `toObjectId` is not wrapped in error handling in several GET/PATCH handlers.

**Recommended solution:** Wrap `toObjectId(id)` in try/catch and return 400 `INVALID_ID` on failure (pattern already used in payment-plan instalments and invoice void routes).

**Priority:** Medium  
**Verification method:** Test requests with non-ObjectId strings return 400, not 500.

### S-2 — Inconsistent error handling (MEDIUM)

**Affected files:** `src/app/api/orders/route.ts` (POST has no try/catch), several report routes.

**Business impact:** Unexpected DB failures return raw Next.js 500s instead of the standard `{ error: { code, message } }` envelope.

**Recommended solution:** Wrap mutation bodies in try/catch returning the standard error envelope; centralise where practical without changing behaviour.

**Priority:** Medium  
**Verification method:** Exercise failure paths and assert standard error envelope.

### S-3 — Credentials present in local `.env` (MEDIUM / risk)

**Affected file:** `.env` (untracked, git-ignored, not in history)

**Business impact:** If a developer's machine is compromised, the local MongoDB credentials, JWT secrets, and seed admin password are exposed. Not a repository leak, but a local secret-management risk.

**Recommended solution:** Keep `.env` out of git (already done). Provide a credential rotation checklist. Never log secrets. Prefer environment-provided secrets in production (Render/Vercel env vars) over a committed `.env`.

**Priority:** Medium  
**Verification method:** Confirm `.env` remains untracked and `.env.example` contains only placeholders.

---

## Potential risks (not confirmed — no code change required yet)

| Risk | Area | Notes |
|------|------|-------|
| Rate limiter is in-memory | `src/lib/rate-limit.ts` | Multi-instance deployments share nothing; noted limitation only. |
| `finance/summary` is global | `src/app/api/finance/summary/route.ts` | `outstanding` is invoiced - collected across all orders, not per-order/invoice. Not a bug unless per-order summary is required. |
| Refresh-token reuse revokes whole family | `src/app/api/auth/refresh/route.ts` | Intentional and matches Express backend; safe. |
| Access token returned in login body | `src/app/api/auth/login/route.ts` | By design (client stores in memory); not logged. |
| No CSRF protection | Middleware | Same-site lax httpOnly refresh cookie mitigates; API routes use bearer token. |

---

## Existing test baseline

**No automated tests exist** in the repository (no `*.test.ts`, `*.spec.ts`, vitest/jest config). This is a gap to be closed in Phase 0 Step 5: tests must be added for every fixed issue. Because tests require a live MongoDB database (no test database/seeding is configured), test execution against real infrastructure is a limitation to document.

---

## Verification summary (baseline, pre-change)

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `tsc --noEmit` | PASS |
| Production build | `next build` | PASS |
| Lint | `oxlint` | PASS (warnings only) |
| Tests | none configured | N/A |

## Recommended fix order

1. C-1 Supplier cost snapshot (Critical — corrupts financials)
2. C-2 Audit logging (High — underpins all other fixes' observability)
3. C-3 Payment allocation (High — financial integrity)
4. C-4 Workflow task PATCH (High)
5. C-5 Payment plans (High)
6. S-1 / S-2 (Medium)
7. S-3 credential handling (documentation/checklist)
