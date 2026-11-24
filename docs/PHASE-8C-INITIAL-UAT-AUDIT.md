# Phase 8C — Initial UAT & Regression Audit Report

**Repository:** Skills Connect Admin  
**Branch:** `rony-dev`  
**HEAD:** `0593e7ab10a1e0e810bd7a6d9a9223b94ac149a9`  
**Audit Type:** Read-only (no source changes, no commits, no deploy)  
**Date:** 2026-11-24  
**Final Verdict:** READY WITH BLOCKERS

---

## 1. Executive Summary

This is an initial read-only User Acceptance Testing (UAT) and regression audit of the Skills Connect Admin application following completion of Phases 7, 8, 8A and 8B. The codebase is functionally complete for the scoped work, passes all automated checks (340 tests, typecheck, lint, production build), and enforces the Phase 8B AUD-only policy for new financial transactions while preserving historical multi-currency records.

Two significant findings prevent a "READY FOR PHASE 8C IMPLEMENTATION" verdict:

1. **QuickBooks transport layer is not implemented** in the Next.js frontend. OAuth flow, token encryption, sync queue, and webhook endpoint exist, but `retrySync()` returns `"QuickBooks transport not implemented in Next.js."` — no actual Intuit API calls are made. Live QB sync cannot be verified without sandbox credentials and a transport implementation.

2. **No background job infrastructure exists.** No BullMQ worker, no Redis integration, no background processor. Jobs run inline or are deferred. The deployment docs reference a background worker and Redis that are not implemented in this repository.

No security controls were weakened. All financial masking, RBAC, order access, and AUD validation are enforced server-side.

---

## 2. Git State Verification

| Check | Result |
|---|---|
| Current branch | `rony-dev` |
| HEAD commit | `0593e7ab10a1e0e810bd7a6d9a9223b94ac149a9` |
| Expected HEAD match | Yes |
| Working tree clean | Yes |
| Ahead of `origin/rony-dev` | 0 |
| Behind `origin/rony-dev` | 0 |
| Remote | `origin` → `https://github.com/Amir-Hamza-Rony/Skills-Connect-Admin` |

**Phase commits confirmed present:**
- Phase 7 — `4f8731e` feat(phase-7): complete price matrix import and preview (13 files)
- Phase 8 — `0102e24` docs(phase-8): initial production readiness audit (1 file)
- Phase 8A — `1576ea5` feat(phase-8a): stabilize deployment configuration and environment variables (4 files)
- Phase 8B — `0593e7a` feat(phase-8b): enforce AUD-only for new financial transactions (21 files)

Total: 39 files across 4 commits. No uncommitted changes.

---

## 3. Testing Environment

All verification performed locally against the repository's in-memory/MongoDB test fixtures. No production database, production services, or real QuickBooks/payment/invoice/external API transactions were accessed or executed.

| Tool | Command | Result |
|---|---|---|
| Vitest | `npm test` | 26 files passed, 340 tests passed, 0 failed |
| TypeScript typecheck | `npm run typecheck` | Passed (`next typegen && tsc --noEmit`) |
| ESLint (oxlint) | `npm run lint` | Passed (exit 0), pre-existing unused-var warnings only |
| Production build | `npm run build` | Passed (exit 0) |

**Pre-existing baseline:** 327 tests passed before Phase 8B; 340 after (13 new Phase 8B tests added). No regressions.

---

## 4. Module-by-Module UAT Results

### 4.1 Authentication & Security

| Area | Finding | Status |
|---|---|---|
| Login / logout | JWT access (15 min) + httpOnly rotating refresh cookie (7 days); verified via `verifyAccessToken` | PASS (code review) |
| Access token / refresh token | `verifyAccessToken` validates signature/expiry; `refreshAccessToken` rotates tokens | PASS (code review) |
| Password hashing | argon2id | PASS (code review) |
| Session expiration | Access TTL 15 min, refresh TTL 7 days; configurable via env | PASS (code review) |
| Unauthorized API access | `withAuth` returns 401 without token, 403 without permission | PASS (code review) |
| Role-based route protection | `ROUTE_PERMISSIONS` maps routes to permissions; server-side `requirePermission` enforces | PASS (code review) |
| SUPER_ADMIN / ADMIN / BDC / B2B_AGENT | Full RBAC matrix in `permissions.ts`; SUPER_ADMIN bypasses permission checks | PASS (code review) |
| Client / Order ownership | `checkOrderAccess` uses user-id space (`bdc_id` / `b2b_agent_id`); agent ObjectIds intentionally excluded; legacy ownerless orders fail closed (admin-only) | PASS (code review) |
| Financial field masking | `maskFinancialFields` + `applyFinancialVisibility`: hides supplierCost/margin from BDC/B2B_AGENT; hides price/revenue from B2B_AGENT (fail-closed); SUPER_ADMIN/ADMIN see all | PASS (code review) |
| Protected M0 helpers | `checkOrderAccess`, `getAccessibleClientIds`, `checkClientAccess`, `maskFinancialFields`, `filterOrdersByRole` unmodified | PASS |
| Rate limiting | In-memory fixed-window on login (IP + email keyed); no Redis backing | PASS (code review), LIMITATION noted |

**Security issue found:** QuickBooks webhook `safeEqual()` in `src/app/api/integrations/quickbooks/webhook/route.ts:22` calls `timingSafeEqual(bufA, bufA)` instead of `timingSafeEqual(bufA, bufB)` in the length-mismatch branch. Since the function returns `false` immediately after on length mismatch, this dead code is not exploitable for auth bypass, but it is sloppy and should be corrected.

### 4.2 Master Data & Pricing

| Area | Finding | Status |
|---|---|---|
| Qualification CRUD | Routes exist; validation via `safeObjectId`; active-status checks | PASS (code review) |
| RTO CRUD | Routes exist; accreditation status enum; active/suspended/at-risk/inactive | PASS (code review) |
| Sourcing Agent CRUD | Agent types: sales_closing, certificate_source, rto_contact; active flag | PASS (code review) |
| Qualification-RTO mappings | Active-status validation required for order creation | PASS (code review) |
| Supplier route validation | Price Matrix import validates overlapping effective windows, duplicate agents, agent type/active status | PASS (code review + tests) |
| Duplicate prevention | Import guard document (`price_matrix_lock`) via MongoDB `_id` unique index; duplicate route detection | PASS (code review) |
| Active-date overlap | Batch-level and DB-level overlap detection for qualification+RTO combinations | PASS (code review) |
| Price categories / price lists | Active status required; price list amount used as server-side selling price | PASS (code review) |
| Additional fees | Qualification-scoped; active/effective-date validation | PASS (code review) |
| Price Matrix preview | ExcelJS parsing; RTO code/name resolution; no persistence; pending-review flagging | PASS (code review) |
| Price Matrix import | Guard mutual exclusion, overlap detection, idempotency, pending/error reporting, audit | PASS (code review + tests) |
| Order price snapshot immutability | Supplier cost snapshot captured server-side from active route at creation; never overwritten by later price changes | PASS (code review) |

### 4.3 Client & Order Workflow

| Area | Finding | Status |
|---|---|---|
| Client creation | `clients` collection; duplicate validation via unique constraints | PASS (code review) |
| Order creation | Server-side validation: client exists, qualification-RTO mapping active, supplier route active; selling price from price list server-side | PASS (code review) |
| Qualification selection | Mapping must exist and be active | PASS (code review) |
| RTO route selection | Active supplier route required for qualification+sourceAgent+RTO | PASS (code review) |
| Processing / documents | Document upload, review, approval/rejection routes exist | PASS (code review) |
| Status updates | `PATCH /api/orders/[id]/status` with `ALLOWED_TRANSITIONS`; audit trail on every transition | PASS (code review) |
| Duplicate client validation | Implemented | PASS (code review) |
| Order validation | Required fields: clientId, qualificationId, salesAgentId, sourceAgentId, rtoId, sellingPrice | PASS (code review) |
| Valid / invalid status transitions | Complete `ALLOWED_TRANSITIONS` map; `INVALID_TRANSITION` error for disallowed moves | PASS (code review) |
| All 21 OrderStatus values | Lead, Qualified, Won, Lost, New, Awaiting Payment, Awaiting Documents, Documents Under Review, Ready for Submission, Submitted to Source Agent, Submitted to RTO, RTO Acknowledged, Under Assessment, Additional Evidence Required, Rework Required, Approved, Certificate Issued, Completed, On Hold, Cancelled, Refunded | PASS (code review) |
| Exact ALLOWED_TRANSITIONS behavior | All 21 statuses have defined transitions; terminal states (Lost, Completed, Cancelled, Refunded) have empty allowed lists | PASS (code review) |
| Owner-based access restrictions | `checkOrderAccess` + `filterOrdersByRole` scope BDC/B2B_AGENT to owned orders | PASS (code review) |
| Historical record integrity | No migrations; historical orders retain original currency/snapshot | PASS (code review) |

### 4.4 Documents & Operations

| Area | Finding | Status |
|---|---|---|
| Document upload | `POST /api/documents/upload` with `finance.manage` permission | PASS (code review) |
| Document metadata / storage | BSON Binary in MongoDB (no S3) | PASS (code review) |
| Signed / private access | `GET /api/documents/[id]/download`; access control via auth | PASS (code review) |
| Document approval / rejection | `PATCH /api/documents/[id]/review` | PASS (code review) |
| Versioning | Not explicitly implemented as separate version records | NOT TESTED |
| Access logs | `GET /api/documents/[id]/access-log` | PASS (code review) |
| Overdue / licensing workflows | Document status enum includes Requested/Not Received/Received/Under Review/Approved/Rejected/Superseded | PASS (code review) |
| RTO processing validation | `POST /api/rto-processing` with AUD currency restriction | PASS (code review + tests) |

### 4.5 Finance & AUD Currency

| Area | Finding | Status |
|---|---|---|
| AUD only for new transactions | `newTransactionCurrencyError()` enforced on invoices, payments, commission records, payouts, orders, commission rules, additional-fees, rto-processing | PASS (code review + tests) |
| New invoices use AUD | Rejects non-AUD with 400 `BAD_REQUEST` | PASS (tests) |
| New payments use AUD | Absent currency defaults to AUD; non-AUD rejected | PASS (tests) |
| New commissions use AUD | Commission rule must be AUD; `exchangeRate=null`, `convertedAmount=commissionAmount` | PASS (tests) |
| New payouts use AUD | Must match record currency (AUD); non-AUD rejected | PASS (tests) |
| Missing currency defaults to AUD | Payments: `currency ?? "AUD"`; invoices/orders require explicit AUD | PASS (code review) |
| New non-AUD rejected | 400 `BAD_REQUEST` with message naming AUD; no row persisted | PASS (tests) |
| Historical BDT/USD/GBP/EUR/INR readable | `Currency` type unchanged; historical records preserved; seeding via DB in tests confirms readability | PASS (tests) |
| Historical amounts/currencies unchanged | No migration; no field rewriting | PASS (code review + tests) |
| No exchange-rate provider | No external FX API; `exchangeRate = 1` placeholder removed from orders and commission records | PASS (code review + tests) |
| No currency conversion | `converted: false` always; `exchangeRate = null` for new transactions | PASS (code review + tests) |
| Mixed-currency reports | Per-currency breakdown; top-level totals `null` when mixed; no cross-currency summation | PASS (code review + tests) |
| Payment allocation / reversal | `finance-classification.ts`: collected/unallocated/excluded definitions shared across reports | PASS (code review + tests) |
| Commission calculation / payout | AUD-only rule; payout must match record currency | PASS (tests) |
| Financial authorization / masking | `applyFinancialVisibility` + `maskFinancialFields` enforced on order list responses | PASS (code review) |

### 4.6 QuickBooks Integration

| Area | Finding | Status |
|---|---|---|
| OAuth flow | Callback validates state, exchanges code for tokens via Intuit endpoint | PASS (code review) |
| Token encryption | AES-256-GCM with scrypt-derived key from `QB_ENCRYPTION_KEY`; tokens never logged/returned | PASS (code review) |
| Token refresh | `refreshAccessToken()` refreshes 5 min before expiry; marks expired on failure | PASS (code review) |
| Webhook validation | HMAC-SHA256 signature verification; event deduplication via `qb_webhook_events` | PASS (code review), MINOR BUG in `safeEqual` |
| Queue / retry architecture | `qb_sync_records` collection with idempotency key, attempts, status, error tracking | PASS (code review) |
| Failure handling | Sync records marked Failed with `syncError`; retry increments attempts | PASS (code review) |
| Missing configuration | `isQuickBooksConfigured()` checks `QB_CLIENT_ID` + `QB_CLIENT_SECRET`; graceful degradation | PASS (code review) |
| Real Intuit API integration | **NOT IMPLEMENTED.** `retrySync()` returns `"QuickBooks transport not implemented in Next.js."` No fetch to Intuit accounting API for invoice/payment push/pull. | **FAIL (gap)** |

**QuickBooks verdict:** Infrastructure (OAuth, encryption, queue, webhook, retry) is complete, but the actual transport layer to Intuit is absent. Live sync cannot function without it. Sandbox credentials are not available in this environment.

### 4.7 Excel Import & Reporting

| Area | Finding | Status |
|---|---|---|
| Import templates | `GET /api/excel/templates` | PASS (code review) |
| Excel parsing | ExcelJS library; `.xlsx`/`.xls`; 10 MB limit | PASS (code review) |
| Preview behavior | Price Matrix preview returns unresolved rows; no persistence | PASS (code review) |
| Import history | `excel_imports` collection; also used for price_matrix_lock guard docs | PASS (code review) |
| Error reporting | Per-row pending/errors with reason codes; import audit record | PASS (code review + tests) |
| Duplicate handling | Overlap detection; guard mutual exclusion; pending for conflicts | PASS (code review + tests) |
| Price Matrix import | Full pipeline: preview → map → import with validation | PASS (code review + tests) |
| Reports and filters | Finance summary, outstanding report, dashboard analytics | PASS (code review + tests) |
| Excel / PDF export | Referenced in legacy docs; Express backend removed from repo | NOT TESTED (no Express server present) |

### 4.8 Background Jobs & Infrastructure

| Area | Finding | Status |
|---|---|---|
| Redis integration | **NOT IMPLEMENTED.** `render.yaml` provisions Redis but application code does not connect to it. Rate limiting is in-memory only. | **FAIL (gap)** |
| BullMQ / worker | **NOT IMPLEMENTED.** No `BullMQ`, no `Queue`, no `Worker`, no `server/dist/worker.js`. The Express backend (`server/`) was removed from the repo. | **FAIL (gap)** |
| Overdue task processing | No background overdue sweep; DEPLOYMENT.md notes jobs run inline or deferred | **FAIL (gap)** |
| QuickBooks background sync | No background processor; sync records created but transport not implemented | **FAIL (gap)** |
| Retry handling | Manual retry via `retrySync()`; no automatic retry scheduler | PARTIAL |
| Rate limiting | In-memory fixed-window; single-instance only | PARTIAL |
| Deployment env config | `render.yaml` + `DEPLOYMENT.md` + `ENVIRONMENT_VARIABLES.md` complete; `QB_ENCRYPTION_KEY` marked `sync: false` | PASS (code review) |

**Infrastructure verdict:** Deployment documentation is complete, but the background worker / Redis / BullMQ infrastructure referenced in `render.yaml` and `DEPLOYMENT.md` is not implemented in this Next.js-only repository. This is a known architectural gap (Next.js serverless cannot run long-lived workers).

---

## 5. Business Workflow UAT Matrix

| ID | Module | Scenario | Expected Result | Actual Result | Status | Evidence |
|---|---|---|---|---|---|---|
| A-1 | Auth | Unauthenticated API request returns 401 | 401 UNAUTHENTICATED | Code enforces via `verifyToken` | PASS | `src/middleware/auth.ts:72-78` |
| A-2 | Auth | Missing permission returns 403 | 403 FORBIDDEN | Code enforces via `requirePermission` | PASS | `src/middleware/auth.ts:58-63` |
| A-3 | Auth | SUPER_ADMIN bypasses permission check | Access granted | Code bypasses at `auth.ts:55` | PASS | `src/middleware/auth.ts:55-57` |
| A-4 | Security | BDC cannot see supplier cost/margin | Fields masked | `maskFinancialFields` + `applyFinancialVisibility` | PASS | `src/lib/permissions.ts:210-240`, `src/lib/financial-visibility.ts` |
| A-5 | Security | B2B_AGENT cannot see selling price/revenue | Fields masked | `applyFinancialVisibility` fail-closed | PASS | `src/lib/financial-visibility.ts:79-83` |
| A-6 | Security | Legacy order with no owner fails closed | Admin-only access | `checkOrderAccess` returns false | PASS | `src/middleware/auth.ts:139-155` |
| M-1 | Master Data | Order creation requires active Qualification-RTO mapping | 400 if missing | Code checks `qualification-rto-mappings` | PASS | `src/app/api/orders/route.ts:148-163` |
| M-2 | Master Data | Order creation requires active supplier route | 400 if missing | Code checks `supplier-routes` | PASS | `src/app/api/orders/route.ts:169-195` |
| M-3 | Master Data | Supplier cost snapshot captured server-side | Client cannot set it | Code reads from route, ignores client input | PASS | `src/app/api/orders/route.ts:196-197` |
| M-4 | Pricing | Price Matrix import prevents overlapping active routes | Pending for overlap | Overlap detection in import route | PASS | `src/app/api/excel/price-matrix/import/route.ts:235-254` |
| O-1 | Orders | All 21 OrderStatus values defined | 21 values | Type defines all 21 | PASS | `src/lib/types.ts:180-201` |
| O-2 | Orders | Invalid status transition returns 400 | 400 INVALID_TRANSITION | `ALLOWED_TRANSITIONS` check | PASS | `src/app/api/orders/[id]/status/route.ts:89-95` |
| O-3 | Orders | Status transition writes audit trail | Audit record created | `writeAudit` called on transition | PASS | `src/app/api/orders/[id]/status/route.ts:108-116` |
| O-4 | Orders | Owner can only access own orders | `checkOrderAccess` scopes | BDC/B2B_AGENT filtered by user-id | PASS | `src/middleware/auth.ts:139-155` |
| F-1 | Finance | New invoice with BDT currency rejected | 400 BAD_REQUEST | `newTransactionCurrencyError` | PASS | `src/app/api/invoices/route.ts` + tests |
| F-2 | Finance | New invoice defaults to AUD | Currency stored as AUD | Phase 8B enforcement | PASS | Tests: `phase8b-finance-fx.test.ts` |
| F-3 | Finance | New payment absent currency defaults to AUD | Currency = AUD | `currency ?? "AUD"` | PASS | `src/app/api/payments/route.ts` |
| F-4 | Finance | New payment with USD rejected | 400 BAD_REQUEST | `newTransactionCurrencyError` | PASS | Tests: `phase8b-finance-fx.test.ts` |
| F-5 | Finance | New commission requires AUD rule | 400 if non-AUD rule | Commission rule check | PASS | Tests: `phase8b-finance-fx.test.ts` |
| F-6 | Finance | New payout with non-AUD rejected | 400 BAD_REQUEST | Currency must be AUD | PASS | Tests: `phase8b-finance-fx.test.ts` |
| F-7 | Finance | Historical BDT invoice remains readable | Currency preserved, no conversion | Direct DB seed test | PASS | Tests: `phase8b-finance-fx.test.ts` |
| F-8 | Finance | Mixed-currency summary does not cross-currency sum | Top-level totals null | Finance summary route | PASS | `src/app/api/finance/summary/route.ts` |
| F-9 | Finance | `converted` always false | `converted: false` | Finance summary route | PASS | `src/app/api/finance/summary/route.ts:141` |
| Q-1 | QuickBooks | OAuth callback validates state | 403 on state mismatch | State check at callback | PASS | `src/app/api/integrations/quickbooks/callback/route.ts:23-28` |
| Q-2 | QuickBooks | Tokens encrypted at rest | AES-256-GCM | `encryptToken`/`decryptToken` | PASS | `src/lib/quickbooks.ts:55-87` |
| Q-3 | QuickBooks | Won't store plaintext without encryption key | Fail closed | `QB_ENCRYPTION_KEY` required | PASS | `src/lib/quickbooks.ts:158-160` |
| Q-4 | QuickBooks | Token refresh implemented | Refresh 5 min before expiry | `refreshAccessToken()` | PASS | `src/lib/quickbooks.ts:187-268` |
| Q-5 | QuickBooks | Webhook verifies HMAC signature | 401 on bad signature | `createHmac` + `safeEqual` | PASS | `src/app/api/integrations/quickbooks/webhook/route.ts` |
| Q-6 | QuickBooks | Real Intuit API transport implemented | Push/pull invoices/payments | **"QuickBooks transport not implemented in Next.js"** | FAIL | `src/lib/quickbooks.ts:496` |
| Q-7 | QuickBooks | Sync queue with idempotency | `qb_sync_records` | `enqueueSync` + `retrySync` | PASS | `src/lib/quickbooks.ts:399-455` |
| B-1 | Background | BullMQ worker implemented | Background job processor | Not present in repo | FAIL | Code search: no BullMQ/Queue/Worker |
| B-2 | Background | Redis connected | Rate limiting + jobs via Redis | In-memory only; no Redis client | FAIL | `src/lib/rate-limit.ts`; code search |
| B-3 | Background | Overdue task processing | Background sweep | Not implemented; inline/deferred | FAIL | `DEPLOYMENT.md` architecture section |
| E-1 | Excel | Price Matrix import validates agent type | certificate_source required | Import route checks `agent.type` | PASS | `src/app/api/excel/price-matrix/import/route.ts:159-161` |
| E-2 | Excel | Import audit record written | `writeAudit` called | Import route writes audit | PASS | `src/app/api/excel/price-matrix/import/route.ts:411-424` |

---

## 6. Security Findings

| Severity | Issue | Location | Recommendation |
|---|---|---|---|
| Low | `safeEqual()` calls `timingSafeEqual(bufA, bufA)` instead of `timingSafeEqual(bufA, bufB)` on length-mismatch branch (dead code, not exploitable) | `src/app/api/integrations/quickbooks/webhook/route.ts:22` | Correct to `timingSafeEqual(bufA, bufB)` |
| Low | Rate limiter is in-memory only; does not work across multiple Next.js instances | `src/lib/rate-limit.ts` | Back with Redis or use external rate limiter for multi-instance deploys |
| Informational | `.env` exists locally but is gitignored — not committed | Root `.env` | Continue to keep out of version control |
| Informational | No Express server in repo (`server/` removed) | Root | Deployment docs reference Express backend that is absent; reconcile docs or implement |

---

## 7. Finance and AUD Compliance Findings

All Phase 8B business rules are verified as implemented and tested:

1. **New invoices, payments, commissions, payouts, orders, commission rules, additional-fees, rto-processing** all require AUD; non-AUD rejected with `400 BAD_REQUEST`.
2. **Absent currency defaults to AUD** on payments only; invoices/orders require explicit AUD.
3. **Historical records preserved** — `Currency` type unchanged, no migration, no field rewriting, direct DB seeding confirms readability of BDT/USD/GBP/EUR/INR.
4. **No exchange-rate provider** — no external FX API; `exchangeRate = 1` placeholder removed; `converted: false` always.
5. **No cross-currency summation** — finance summary returns null top-level totals when multiple currencies present.
6. **Financial masking intact** — `applyFinancialVisibility` and `maskFinancialFields` enforced server-side.
7. **13 new Phase 8B tests** all pass; existing 327 tests continue passing.

**Finance verdict:** Fully compliant with approved business rules. No issues.

---

## 8. QuickBooks Integration Status

**Status: PARTIAL — infrastructure complete, transport missing.**

Implemented:
- OAuth 2.0 authorization URL and callback with state validation
- Token exchange with Intuit OAuth endpoint
- AES-256-GCM encryption of access/refresh tokens at rest
- Token refresh (5-min-before-expiry)
- Fail-closed: refuses to store plaintext without `QB_ENCRYPTION_KEY`
- Sync queue (`qb_sync_records`) with idempotency, attempts, status, error tracking
- Manual retry via `retrySync()`
- Webhook endpoint with HMAC-SHA256 signature verification and event deduplication
- Connection status endpoint

Not implemented:
- **Actual Intuit Accounting API transport** — `retrySync()` returns `"QuickBooks transport not implemented in Next.js."` No fetch to push/pull invoices, payments, or customers.
- No sandbox credentials available in this environment; live integration not verified.

**Recommendation:** Implement QB transport layer (invoice/payment push, query) or document that QB sync requires the removed Express backend. Do not claim live verification without sandbox evidence.

---

## 9. Background Jobs and Infrastructure Findings

**Status: NOT IMPLEMENTED.**

- No BullMQ, Queue, or Worker in the codebase.
- No Redis client or connection.
- `render.yaml` provisions a Redis service (`skills-connect-redis`) but the application does not connect to it.
- Rate limiting is in-memory (single-instance only).
- `DEPLOYMENT.md` describes a background worker service and BullMQ that are absent from this Next.js-only repository.
- The Express backend (`server/`) was removed from the repo (gitignored).
- Jobs run inline or are deferred; no automatic overdue sweep or QB background sync scheduler.

**Recommendation:** Either implement a background worker (e.g., BullMQ + Redis in a separate service) or update `DEPLOYMENT.md`/`render.yaml` to reflect the Next.js-only architecture where jobs run inline.

---

## 10. Automated Test Results

| Command | Exit Code | Output Summary |
|---|---|---|
| `npm test` | 0 | 26 test files passed, 340 tests passed, 0 failed |
| `npm run typecheck` | 0 | Types generated successfully; `tsc --noEmit` clean |
| `npm run lint` | 0 | Passed; pre-existing unused-variable warnings only (no errors) |
| `npm run build` | 0 | Production build succeeded; all routes compiled |

**Baseline comparison:** Before Phase 8B: 327 tests passed. After Phase 8B: 340 tests passed (13 new). No regressions. `tsc-errors.txt` is empty (no pre-existing type errors).

---

## 11. Critical, High, Medium and Low Severity Issues

### Critical
None.

### High
None.

### Medium
1. **QuickBooks transport not implemented** — live sync cannot function; sync queue exists but no Intuit API calls are made.
2. **No background job infrastructure** — no BullMQ/Redis/worker; overdue processing and QB background sync cannot run automatically.

### Low
1. **QuickBooks webhook `safeEqual()` dead-code bug** — `timingSafeEqual(bufA, bufA)` instead of `timingSafeEqual(bufA, bufB)` on length-mismatch branch; not exploitable but should be corrected.
2. **In-memory rate limiter** — does not scale across multiple Next.js instances.
3. **Deployment docs reference absent Express backend** — `DEPLOYMENT.md` describes server/ worker that was removed from repo.

---

## 12. Blockers and Dependencies

| Blocker | Dependency | Resolution Required |
|---|---|---|
| QuickBooks live sync | QB transport layer + sandbox credentials | Implement Intuit API transport; obtain sandbox credentials for verification |
| Background jobs / overdue processing | BullMQ + Redis worker service | Implement worker or update docs to reflect inline-only architecture |
| Multi-instance rate limiting | Redis-backed rate limiter | Implement Redis backing or document single-instance limitation |

---

## 13. Recommended Fix Priority

1. **High:** Implement QuickBooks transport layer (invoice/payment push/query) so sync queue is functional.
2. **High:** Implement background worker infrastructure (BullMQ + Redis) or update deployment documentation to match the Next.js-only architecture.
3. **Low:** Fix QuickBooks webhook `safeEqual()` dead-code bug.
4. **Low:** Add Redis backing to rate limiter for multi-instance deployments.

---

## 14. Final Verdict

**READY WITH BLOCKERS**

The application passes all automated checks (340 tests, typecheck, lint, build), enforces the AUD-only finance policy correctly, preserves historical multi-currency records, and maintains all security controls (RBAC, financial masking, order access). However, two implementation gaps prevent unconditional readiness:

1. **QuickBooks transport layer is not implemented** — the sync queue and OAuth infrastructure exist, but no actual Intuit API calls are made. Live QB sync cannot be verified or used without this transport and sandbox credentials.
2. **No background job infrastructure** — no BullMQ worker, no Redis, no automatic overdue processing or QB background sync. The deployment documentation references infrastructure that is absent from this Next.js-only repository.

These blockers are architectural/infrastructure gaps, not defects in the implemented business logic. The finance (Phase 8B), price matrix (Phase 7), deployment config (Phase 8A), and production readiness audit (Phase 8) work is complete and verified.

---

**This was a read-only audit. No source code was modified, no commits were made, and no deployment occurred. The only new file created is this report (`docs/PHASE-8C-INITIAL-UAT-AUDIT.md`).**
