# Phase 4 — Finance & QuickBooks Two-way Integration Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Baseline:** Phases 0–3 complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 60 tests PASS.  
**Database:** `skills_connect_admin` is empty (clean slate — no existing financial records to migrate).

---

## Existing implementation

### Invoices

| Route | Method | Auth | Collections | Status |
|-------|--------|------|-------------|--------|
| `GET /api/invoices` | list | `finance.view` | `invoices` | Implemented |
| `POST /api/invoices` | create | `finance.manage` | `invoices` | Implemented |
| `POST /api/invoices/[id]/void` | void | `finance.manage` | `invoices` | Implemented |

**Invoice type** (`src/lib/types.ts`): `id`, `orderId`, `invoiceNumber`, `total`, `dueDate`, `status` (Draft/Sent/Part Paid/Paid/Overdue/Void), `createdAt`.

**Gaps:** No currency, no line items, no issue date, no PDF generation, no history, no duplicate prevention, no validation that total matches order snapshot.

### Payments

| Route | Method | Auth | Collections | Status |
|-------|--------|------|-------------|--------|
| `GET /api/payments` | list | `finance.view` | `payments` | Implemented |
| `POST /api/payments` | record + allocate | `finance.manage` | `payments`, `invoices` | Implemented (transaction-safe) |
| `POST /api/payments/[id]/refund` | refund | `finance.manage` | `payments` | Implemented |

**Payment type**: `id`, `orderId`, `invoiceId`, `amount`, `date`, `method`, `reference`, `allocatedAmount`, `idempotencyKey`, `status` (Allocated/Partially Allocated/Unallocated/Refunded/Void), `createdAt`, `updatedAt`.

**Strengths:** Transaction-safe allocation, idempotency key prevents duplicates, over-allocation prevention, invoice status sync (Paid/Part Paid).

**Gaps:** No currency, no exchange rate, no payment verification status, no exchange-rate source/timestamp.

### Payment plans / instalments

| Route | Method | Collections | Status |
|-------|--------|-------------|--------|
| `POST /api/orders/[id]/payment-plan` | create | `payment-plans` | Implemented |
| `POST /api/payment-plans/[id]/instalments` | add | `payment-plans` | Implemented |

**Gaps:** No currency on instalments, no allocation reversal, instalment amount not validated against plan total.

### Finance summary

`GET /api/finance/summary` — invoiced/collected/outstanding. All hardcoded to AUD, no multi-currency, no per-client/per-order breakdown.

### QuickBooks integration

| Route | Method | Auth | Status |
|-------|--------|------|--------|
| `GET /api/integrations/quickbooks/connect` | OAuth URL | `settings.manage` | Implemented |
| `GET /api/integrations/quickbooks/callback` | OAuth callback | `settings.manage` | Implemented (state validation) |
| `GET /api/integrations/quickbooks/status` | connection health | `finance.view` | Implemented |
| `GET /api/integrations/quickbooks/sync` | list sync records | `finance.view` | Implemented |
| `GET/POST /api/integrations/quickbooks/sync/[type]/[id]` | sync state / retry | `finance.view`/`qb.retry` | Implemented |
| `POST /api/integrations/quickbooks/webhook` | QB webhook | none (signature) | Implemented (signature validation) |

**`src/lib/quickbooks.ts` facade:** `isQuickBooksConfigured`, `authorizationUrl`, `quickBooksStatus`, `exchangeCodeForTokens`, `listSyncRecords`, `syncRecordFor`, `retrySync`.

**Gaps (significant):**
- Token storage is a **placeholder** (`accessToken: "stored:${code}"`, `refreshToken: "stored"`) — no real OAuth token exchange, no encryption, no refresh.
- No actual QuickBooks API transport (no customer/invoice/payment create/update).
- No two-way synchronization logic for customers/invoices/payments.
- Webhook only updates `lastSyncAt` on `qb_sync_records` — does not process events, no event deduplication, no failed-event tracking.
- No background job / worker infrastructure (Next.js route handlers cannot reliably do long-running work).
- No reconciliation or conflict management UI/API.
- `qb_connections` and `qb_sync_records` collections exist in types but are empty.

### Permissions

`finance.view`, `finance.manage`, `qb.retry`, `settings.manage` exist. No `qb.manage` or `finance.reconcile` permission.

### Collections present

`qualifications`, `rtos`, `agents`, `supplier-routes`, `qualification-rto-mappings`, `orders`, `clients`, `invoices`, `payments`, `audit_logs`, `refresh_tokens`, `users`, `roles`, `price_categories`, `price_lists`, `additional_fees`, `agent_commission_rules`, `commission_records`, `commission_payouts`, `rto-processing`, `document_access_logs`.

**Collections NOT present:** `qb_connections`, `qb_sync_records`, `qb_reconciliation`, `currency_rates`.

---

## Confirmed issues & gaps

### F-1 — Invoice lacks currency and line items (Critical)

**Business impact:** Multi-currency invoices impossible; no audit of what constitutes the total; cannot reconcile with multi-currency QuickBooks.

**Technical cause:** `Invoice.total` is a bare number with no `currency`. No `lineItems` array.

**Recommended solution:** Add `currency`, `issueDate`, `lineItems` (array of {description, amount, currency, tax}), `history`, `qbReference`, `qbSyncStatus` to Invoice. Prevent duplicate invoice per order where applicable.

**Priority:** Critical

### F-2 — Payment lacks currency and exchange rate (Critical)

**Business impact:** Multi-currency payments impossible; historical conversions not reproducible; cannot reconcile foreign-currency receipts.

**Technical cause:** `Payment.amount` is a bare number with no `currency` or `exchangeRate`.

**Recommended solution:** Add `currency`, `exchangeRate` (sale currency → reporting currency), `exchangeRateSource`, `exchangeRateAt`, `verificationStatus`, `qbReference`, `qbSyncStatus` to Payment.

**Priority:** Critical

### F-3 — Finance summary is single-currency (High)

**Business impact:** `invoiced`/`collected`/`outstanding` mix currencies meaningless; no per-currency breakdown.

**Technical cause:** `src/app/api/finance/summary/route.ts` sums all totals as numbers with no currency grouping.

**Recommended solution:** Return per-currency breakdown + optional reporting-currency conversion using stored exchange rates.

**Priority:** High

### F-4 — QuickBooks token storage is placeholder (Critical / security)

**Business impact:** No real OAuth2 connection; tokens stored as literal strings (`stored:${code}`); no refresh; tokens not encrypted at rest.

**Technical cause:** `exchangeCodeForTokens` in `src/lib/quickbooks.ts` writes `accessToken: "stored:${code}"`, `refreshToken: "stored"`.

**Recommended solution:** Implement real OAuth2 token exchange against Intuit token endpoint; store access/refresh tokens encrypted at rest; implement token refresh before expiry; never expose tokens to frontend.

**Priority:** Critical (security)

### F-5 — No two-way QuickBooks synchronization (High)

**Business impact:** Customers, invoices, payments cannot sync to/from QuickBooks; manual double-entry.

**Technical cause:** `retrySync` returns "QuickBooks transport not implemented in Next.js." No customer/invoice/payment sync logic.

**Recommended solution:** Implement sync queue (`qb_sync_records`) with idempotency keys, direction tracking, status, attempts, error handling, retry with backoff. Sync customers, invoices, payments. Admin is authoritative for client/qualification/RTO/agent data; QB is authoritative for accounting records created directly in QB (validated before import).

**Priority:** High

### F-6 — Webhook does not process events (High)

**Business impact:** QB changes (invoice paid in QB) not imported; no event deduplication; no failed-event tracking; no dead-letter.

**Technical cause:** Webhook only `updateMany({lastSyncAt})` on matching `qbReference`; no event processing, no dedup, no retry infrastructure.

**Recommended solution:** Validate signature, deduplicate events by `eventId`, enqueue sync records, background retry with backoff, dead-letter for repeated failures, manual recovery.

**Priority:** High

### F-7 — No reconciliation / conflict management (Medium)

**Business impact:** Cannot identify local-vs-QB mismatches, failed syncs, or conflicting updates; financial conflicts silently unresolved.

**Technical cause:** No reconciliation collection or API.

**Recommended solution:** `qb_reconciliation` collection + API to list mismatches (local not synced, QB not imported, amount/currency mismatch), with manual resolution + audit.

**Priority:** Medium

### F-8 — No allocation reversal (Medium)

**Business impact:** Cannot correct a misallocated payment without voiding/refunding.

**Technical cause:** Payment allocation is append-only; no reversal endpoint.

**Recommended solution:** `POST /api/payments/[id]/reverse-allocation` with authorization, history, audit; transaction-safe.

**Priority:** Medium

---

## Multi-currency requirements

- Every monetary value stores its currency (`Currency` union already exists: AUD, BDT, USD, GBP, EUR, INR).
- No hardcoded AUD assumptions (finance summary, UI `aud()` helper currently hardcode AUD).
- Store exchange rates when conversions occur, with source and timestamp.
- Never recalculate historical transactions using today's rate.
- Distinguish original currency totals from reporting currency totals.

**Management decisions needed:**
1. What is the reporting currency for consolidated reporting?
2. What is the approved exchange-rate source (ECB, Intuit, manual)?
3. Are exchange rates locked at transaction time or float?

---

## Migration considerations

- DB is empty — no existing financial records to preserve/migrate.
- Adding `currency` to Invoice/Payment is additive (existing docs lack the field; treat as null/legacy).
- No destructive migration required.

---

## Implementation sequence

1. **Audit document** (this file).
2. **Types** — add `currency`/`lineItems`/`history`/`qbReference`/`qbSyncStatus` to Invoice; add `currency`/`exchangeRate`/`exchangeRateSource`/`exchangeRateAt`/`verificationStatus`/`qbReference`/`qbSyncStatus` to Payment; add `QBConnection`, `QBReconciliation`, `CurrencyRate` types; add `qb.manage`/`finance.reconcile` permissions.
3. **Invoice improvements** — currency, line items, issue date, history, duplicate prevention, PDF placeholder.
4. **Payment improvements** — currency, exchange rate, verification status; allocation reversal endpoint.
5. **Finance summary** — per-currency breakdown + reporting-currency conversion.
6. **QuickBooks OAuth** — real token exchange, encrypted storage, refresh, disconnect.
7. **Two-way sync** — sync queue, customers/invoices/payments, idempotency, retry, ownership boundaries.
8. **Webhooks** — event dedup, processing, background retry, dead-letter.
9. **Reconciliation** — mismatch detection, manual resolution, audit.
10. **Frontend** — invoice/payment/instalment/outstanding/QB connection/sync/reconciliation pages.
11. **Tests** — finance CRUD, allocation, multi-currency, QB OAuth state, sync idempotency, webhook signature, reconciliation.
12. **Verification** — typecheck, lint, build.

---

## Security notes

- OAuth tokens must never be logged or returned to frontend.
- Tokens at rest should be encrypted (or at minimum access-controlled).
- Webhook signature must always be validated (HMAC-SHA256 with `QB_WEBHOOK_SECRET`).
- State parameter must be validated on OAuth callback.
- `QB_WEBHOOK_SECRET`, `QB_CLIENT_SECRET` are production secrets — must not be committed.

**Credential check:** `.env` contains real `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. It is git-ignored and was never committed to history (verified Phase 0). No credential rotation required for Phase 4, but `QB_CLIENT_SECRET`/`QB_WEBHOOK_SECRET` must be added to `.env` (git-ignored) and never logged.
