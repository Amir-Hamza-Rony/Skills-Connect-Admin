# Phase 5 — Production Readiness Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Baseline:** Phases 0–4 complete. Application is functional but production-readiness review not yet performed.

---

## Security

### Authentication & RBAC
- All API routes use `withAuth("permission")` middleware — verified across orders, invoices, payments, clients, qualifications, rtos, agents, pricing, commission, documents, workflow, audit, reconciliation.
- `reports.view` permission exists and is used by all report routes.
- `finance.reconcile` and `qb.manage` added in Phase 4.
- Route handlers check `req.auth` and return 401/403 appropriately.
- Super Admin bypasses permission checks (by design).

### API input validation
- Order creation: validates required fields, supplier route existence, qualification–RTO mapping (Phase 3).
- Invoice creation: validates currency, dates, order existence, duplicate prevention.
- Payment creation: validates amount, currency, method, invoice existence, over-allocation prevention, idempotency.
- Commission rules: validates tiers, dates, agent/responsibility exclusivity.
- **Gap:** No centralized validation middleware — each route validates inline. Inconsistent error formats possible.

### Sensitive information exposure
- API responses never include passwords, tokens, or secrets (verified for auth, QuickBooks, payments).
- QuickBooks tokens encrypted at rest (AES-256-GCM, `QB_ENCRYPTION_KEY`); never returned to frontend.
- Audit logging redacts known-sensitive keys (`password`, `token`, `secret`, `jwt`, `session`).
- **Gap:** Error messages may leak internal details (e.g., MongoDB errors). Need generic error messages in production.

### File upload/download security
- Document upload: validates file type (PDF, JPEG, PNG, WebP, CSV, TXT), max size per type, stores in MongoDB (no S3/presigned URLs).
- Document download: streams bytes, no public URLs, access-logged via `writeDocumentAccessLog`.
- **Gap:** No virus/malware scanning of uploaded files.
- **Gap:** Excel upload (Phase 5) needs file type/size validation and no formula/macro execution.

### QuickBooks token protection
- Tokens encrypted at rest; decrypted only server-side for API calls.
- `getAccessToken()` refreshes 5 minutes before expiry.
- `disconnect()` sets connectionStatus to "disconnected".
- Tokens never logged.

### Webhook verification
- HMAC-SHA256 signature validation using `QB_WEBHOOK_SECRET`.
- Always returns 200 to Intuit (per Intuit requirements).
- Event deduplication via `qb_webhook_events` collection.

### Audit logging
- `writeAudit()` helper used across all mutation routes (orders, invoices, payments, commission, commission rules, reconciliation, rto-processing, price categories/lists/fees, agents).
- Audit failures are swallowed (never break primary operation) and logged to stderr.
- Sensitive keys redacted from before/after.

---

## Database

### Indexes
Existing indexes (via migration scripts):
- `qualifications(code)` unique
- `rtos(rtoCode)` unique
- `agents(name, contact)` unique
- `qualification-rto-mappings(qualificationId, rtoId)` unique
- `price_categories(code)` unique
- `qualification-rto-mappings(qualificationId)`, `(rtoId)` non-unique

**Missing indexes for report/query performance:**
- `orders(clientId)`, `orders(qualificationId)`, `orders(rtoId)`, `orders(status)`, `orders(createdAt)`
- `invoices(orderId)`, `invoices(status)`, `invoices(createdAt)`, `invoices(currency)`
- `payments(orderId)`, `payments(invoiceId)`, `payments(status)`, `payments(createdAt)`
- `commission_records(agentId, periodMonth, periodYear)` unique
- `commission_payouts(commissionRecordId)`
- `rto-processing(orderId)`
- `excel_imports(startedBy, status)`, `excel_import_rows(importId, status)`

### Query performance
- Report routes use `collection.find(filter).toArray()` without indexes on large collections — potential table scans as data grows.
- Pagination uses `skip/limit` — acceptable for moderate data volumes.

### Idempotent migrations
- Migration scripts use `createIndex` (idempotent in MongoDB).
- No destructive migrations.

---

## Business logic verification

### Verified (working correctly)
- Qualification–RTO mapping validation on order creation (409 if missing).
- Supplier route compatibility validation on order creation.
- Order financial snapshot immutability (price/supplier cost captured at creation, never rewritten).
- Monthly commission rules with approval status (draft only by default).
- Invoice/payment calculations server-side (totals computed from line items/allocations).
- Payment allocation: over-allocation prevention, idempotency, transaction-safe, invoice status sync.
- Payment allocation reversal (Phase 4).
- Multi-currency: currency stored per amount, exchange rate snapshots.
- QuickBooks sync retry: idempotency, attempt tracking, failure recording.
- Reconciliation: mismatch detection, manual resolution, audit.
- RTO processing: one record per order, status transitions, history.
- Document access logging: upload/download logged to `document_access_logs`.
- Overdue workflow detection: computed in tasks GET route.

### Not yet verified (Phase 5 to address)
- Excel import validation (missing required fields, invalid references, duplicate detection).
- Import execution idempotency/retry.
- Report multi-currency grouping correctness.
- Export formula injection protection.

---

## Production deployment prerequisites

1. Environment variables: `MONGODB_URI`, `MONGODB_DB`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET`, `QB_ENCRYPTION_KEY`, `QB_REDIRECT_URI`.
2. MongoDB indexes created (run migration script).
3. No `.env` committed to git (verified — `.env` is git-ignored).
4. Build and typecheck pass.
5. Test suite passes.

---

## Implementation sequence for production readiness

1. Add missing database indexes via migration script.
2. Add report endpoints + export.
3. Add Excel import infrastructure.
4. Add Phase 5 tests.
5. Run full verification (tsc, lint, build, tests).
6. Document remaining risks.
