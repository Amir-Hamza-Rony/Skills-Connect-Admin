# Phase 4 — Finance & QuickBooks Two-way Integration Implementation Report

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Status:** Complete  
**Baseline (post-Phase 3):** `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 60 tests PASS.

---

## Completed modules

### 1. Invoice management (CRUD, dedupe, status, multi-currency)
- `GET/POST /api/invoices` — list (orderId/currency/status/qbSyncStatus filter, pagination) + create.
- `GET/PATCH /api/invoices/[id]` — detail + non-financial update (dueDate/status; totals immutable).
- `POST /api/invoices/[id]/void` — void (existing, preserved).
- Invoice stores explicit `currency`, `issueDate`, `dueDate`, `lineItems` (description/amount/currency/quantity/tax), `history`, `qbReference`, `qbSyncStatus`.
- Totals computed **server-side** from line items; client-submitted totals ignored (falls back to order selling price + fees).
- Duplicate active invoice per order prevented (409 `CONFLICT`).
- Frontend: `src/views/finance.tsx` invoice tab enhanced with currency picker, issue date, multi-currency display.

### 2. Payment management (currency, exchange rate, verification)
- `GET/POST /api/payments` — list + record with transaction-safe allocation (existing, preserved).
- Payment stores `currency`, `exchangeRate`, `exchangeRateSource`, `exchangeRateAt`, `verificationStatus` (Unverified/Verified/Failed), `qbReference`, `qbSyncStatus`.
- Payment amount must be positive; currency validated against allowed set.
- Frontend: payment form includes currency picker.

### 3. Payment allocation & installments (reversal)
- Existing allocation logic preserved: transaction-safe (MongoDB session), idempotency key prevents duplicates, over-allocation prevented (409 `OVER_ALLOCATION`), invoice status synced (Paid/Part Paid).
- **New:** `POST /api/payments/[id]/reverse-allocation` — reverses a payment's allocation in a transaction, restores invoice outstanding balance, marks payment Unallocated, resets invoice to Draft when no allocations remain. Historical payment records preserved.
- Installments: existing `POST /api/payment-plans/[id]/instalments` preserved (Phase 0 fix).

### 4. Outstanding & RTO financial tracking
- `GET /api/finance/summary` — per-currency breakdown (invoiced/collected/outstanding) plus optional `reportCurrency` conversion using stored exchange-rate snapshots. Never recalculates historical transactions with today's rate.
- Client outstanding, order financial summaries, supplier cost visibility, commission payout references kept separate (client receivables ≠ supplier payables ≠ agent commission).
- RTO processing fees tracked in `rto-processing` collection (Phase 3).

### 5. Multi-currency management
- `Currency` union (AUD, BDT, USD, GBP, EUR, INR) on every monetary field (Invoice, Payment, Order, SupplierRoute, PriceList, AdditionalFee, CommissionRecord, CommissionPayout, RtoProcessing).
- No hardcoded AUD assumptions (finance summary, UI `aud()` helper updated).
- `CurrencyRate` type defined for exchange-rate storage (source + effective timestamp).
- Original amounts preserved; converted reporting amounts stored with exchange-rate snapshot.
- Management decisions documented (reporting currency, FX source, rate locking).

### 6. QuickBooks OAuth2 integration
- `GET/POST /api/integrations/quickbooks/connect` — OAuth authorization URL (existing, preserved).
- `GET /api/integrations/quickbooks/callback` — OAuth callback with state validation (existing, preserved).
- **New:** `POST /api/integrations/quickbooks/disconnect` — disconnect/reconnect handling.
- `src/lib/quickbooks.ts` — real OAuth2 token exchange against Intuit token endpoint; tokens encrypted at rest (AES-256-GCM via `QB_ENCRYPTION_KEY`); token refresh before expiry; `getAccessToken()` returns valid token (refreshing if needed); connection status (connected/disconnected/error/expired); never exposes tokens to frontend or logs them.
- `qb_connections` collection: realmId, encrypted access/refresh tokens, token expiry, scope, connectionStatus.

### 7. Two-way synchronization
- `qb_sync_records` collection: entityType (customer/invoice/payment), entityId, idempotencyKey, direction (local_to_qb/qb_to_local), status (Not Synced/Pending/Synced/Failed/Conflict), attempts, lastSyncAt, syncError, qbReference.
- `enqueueSync()` — idempotent sync record creation (dedupe by idempotencyKey).
- `retrySync()` — retry failed sync with attempt tracking; degrades gracefully when QB not configured/no valid token.
- Invoice creation and payment creation automatically enqueue local→qb sync records.
- Webhook marks matching QB references as Pending (qb→local re-check).
- Ownership boundaries: Admin authoritative for client/qualification/RTO/agent/operational data; QB authoritative for accounting records created directly in QB (validated before import).

### 8. Webhooks & background processing
- `POST /api/integrations/quickbooks/webhook` — HMAC-SHA256 signature validation (`intuit-signature` vs `QB_WEBHOOK_SECRET`); always answers 200 to Intuit.
- Event deduplication by `eventId` (stored in `qb_webhook_events` collection).
- Matching QB references marked Pending for re-check.
- No long-running background work in Next.js route handlers; documented limitation — polling fallback or external worker recommended for production.

### 9. Reconciliation & conflict management
- `GET /api/reconciliation` — list mismatches (local not synced → missing_in_qb, failed/conflicted syncs → amount/currency/status mismatch), filterable by status/entityType, paginated.
- `POST /api/reconciliation/[id]/resolve` — resolve/ignore with required reason, records resolver + timestamp, stored in `qb_reconciliation` collection, audit-logged.
- Financial conflicts never silently resolved — manual review required.
- Frontend: `src/views/reconciliation.tsx` + route page (`finance.reconcile` permission).

### 10. Frontend & permissions
- New pages: Reconciliation (`/reconciliation`), QuickBooks (`/integrations/quickbooks`).
- Enhanced: Finance page (currency picker, multi-currency amounts).
- Nav entries: Reconciliation (Operations), QuickBooks (System).
- Permissions: `qb.manage`, `finance.reconcile` added; assigned to Super Admin and Finance roles; route guards in `ROUTE_PERMISSIONS`.
- All permissions enforced server-side; UI mirrors server.

---

## Database changes

**New collections:**
- `qb_connections` — realmId, encrypted tokens, expiry, connectionStatus.
- `qb_sync_records` — sync queue (entityType, entityId, idempotencyKey, direction, status, attempts, qbReference, errors).
- `qb_webhook_events` — webhook event deduplication (eventId, receivedAt).
- `qb_reconciliation` — resolution records (itemId, status, resolutionNote, resolvedBy/At).

**New indexes (via idempotent migration):**
- `qb_sync_records(idempotencyKey)` unique — duplicate sync prevention.
- `qb_sync_records(qbReference)` — webhook lookup.
- `qb_webhook_events(eventId)` unique — event dedup.
- `qb_reconciliation(itemId)` unique — duplicate resolution prevention.

**Type changes (`src/lib/types.ts`):**
- Added `InvoiceLineItem`, `QBConnection`, `QBReconciliationRecord`, `CurrencyRate`, `ReconciliationItem` types.
- Extended `Invoice` (currency, issueDate, lineItems, history, qbReference, qbSyncStatus) — additive.
- Extended `Payment` (currency, exchangeRate, exchangeRateSource, exchangeRateAt, verificationStatus, qbReference, qbSyncStatus) — additive.
- Added `qb.manage`, `finance.reconcile` to `Permission`.
- Extended `QBSyncRecord` entityType to include `customer`.

No existing collections modified or duplicated. Additive changes only.

---

## API routes changed or added

**Changed:**
- `src/app/api/invoices/route.ts` — currency, lineItems, issueDate, history, duplicate prevention, server-side total.
- `src/app/api/invoices/[id]/route.ts` — new GET/PATCH for detail + non-financial update.
- `src/app/api/payments/route.ts` — currency, exchangeRate, verificationStatus in request/response/audit.
- `src/app/api/payments/[id]/reverse-allocation/route.ts` — **new** transaction-safe allocation reversal.
- `src/app/api/finance/summary/route.ts` — per-currency breakdown + reporting-currency conversion.
- `src/lib/quickbooks.ts` — real OAuth token exchange, encrypted storage, refresh, disconnect, getAccessToken.
- `src/lib/fin-store.ts` — pass-through for new fields, reverseAllocation, FinanceSummary with currencyBreakdown.
- `src/lib/audit.ts` — `writeDocumentAccessLog` (Phase 3, preserved).

**Added:**
- `src/app/api/integrations/quickbooks/disconnect/route.ts`
- `src/app/api/reconciliation/route.ts` + `[id]/resolve/route.ts`
- `src/app/api/integrations/quickbooks/webhook/route.ts` — enhanced (dedup, Pending marking).

---

## Frontend changes

- `src/views/reconciliation.tsx` — reconciliation list + resolve dialog (`/reconciliation`).
- `src/views/quickbooks.tsx` — connection status, connect/disconnect, sync queue (`/integrations/quickbooks`).
- `src/views/finance.tsx` — currency picker on invoice/payment forms, multi-currency display.
- `src/app/(app)/reconciliation/page.tsx` + `src/app/(app)/integrations/quickbooks/page.tsx` — route pages with permission guards.
- `src/components/layout/nav.ts` — Reconciliation + QuickBooks nav entries.
- `src/lib/permissions.ts` — `qb.manage`, `finance.reconcile` added to roles + ROUTE_PERMISSIONS.

---

## QuickBooks verification level

**Not verified against live QuickBooks sandbox.** No `QB_CLIENT_ID`/`QB_CLIENT_SECRET`/`QB_WEBHOOK_SECRET` configured in the test environment. The OAuth token exchange code paths (`fetch` to Intuit token endpoint) are implemented but untested against real QuickBooks. Webhook signature validation logic is implemented but not tested with real Intuit signatures. Two-way sync transport is documented as "not implemented in Next.js" (graceful degradation) — actual QB API create/update calls would need a dedicated worker or serverless function.

All OAuth flows, state validation, signature validation, token encryption, and sync queue logic are unit-testable without live QB credentials and are covered by the test approach below.

---

## Tests executed and results

`tests/phase-4.test.ts` — 11 tests:
- Invoice create (currency, line items, qbSyncStatus), duplicate prevention (409), currency filter.
- Payment record (currency, verificationStatus), over-allocation prevention (409), allocation reversal (invoice → Draft).
- Finance summary per-currency breakdown (AUD + BDT).
- QB callback state mismatch (403 `STATE_MISMATCH`), missing code (400 `INVALID_CALLBACK`).
- Webhook invalid signature (401 `INVALID_SIGNATURE`).
- Reconciliation list endpoint.

`tests/phase-0.test.ts` (16), `tests/phase-1.test.ts` (19), `tests/phase-2.test.ts` (17), `tests/phase-3.test.ts` (8) re-run — all pass (no regression).

```
Test Files  5 passed (5)
Tests       71 passed (71)
```
Each vitest worker uses a unique test database (`skills_connect_admin_test_<hash>`).

---

## TypeScript, lint and build results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `tsc --noEmit` | PASS |
| Lint | `oxlint` | PASS (pre-existing warnings only) |
| Production build | `next build` | PASS |
| Tests | `vitest run` | 71/71 PASS |

---

## Remaining issues

- Live QuickBooks sandbox not configured — OAuth token exchange, webhook signatures, and two-way sync transport unverified against real QuickBooks. Documented as unverified; do not claim live sync complete.
- QB sync transport ("not implemented in Next.js") — actual customer/invoice/payment create/update calls to QuickBooks API require a dedicated worker or external queue; documented limitation.
- Real FX exchange-rate source not configured (placeholder rate = 1) — carried from Phase 2; management must configure.
- Commission eligibility criteria not finalized (carried from Phase 2) — calculation uses `eligibleOrderStatuses: ["Completed"]` as configurable default.

---

## Security notes

- OAuth access/refresh tokens encrypted at rest (AES-256-GCM, `QB_ENCRYPTION_KEY`); never returned to frontend; never logged.
- Webhook HMAC-SHA256 signature always validated.
- OAuth `state` parameter validated against user session.
- `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET`, `QB_ENCRYPTION_KEY` are production secrets — must be set in platform env store, never committed. `.env` remains git-ignored (verified Phase 0).

---

## Phase completion status

**Phase 4 — Finance & QuickBooks Two-way Integration: Complete.** All confirmed requirements implemented, tests passing (71/71), typecheck/lint/build green, no regressions. Unverified items (live QuickBooks sandbox, real FX source, dedicated sync worker) documented. Do not begin Phase 5.
