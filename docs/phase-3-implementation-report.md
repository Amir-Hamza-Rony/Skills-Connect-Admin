# Phase 3 — Client, Order & Operational Management Implementation Report

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Status:** Complete  
**Baseline (post-Phase 2):** `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 52 tests PASS.

---

## Completed functionality

### Client management (existing, reused & verified)
- `GET/POST /api/clients`, `GET/PATCH /api/clients/[id]` — create, list, get, patch.
- Email-based duplicate prevention (409 CONFLICT).
- Client profile page (`src/views/client-profile.tsx`) with Orders/Contacts/Communications/Documents/Payments/Invoices/Timeline/Notes/Audit tabs; orders history per client; document and financial summaries.
- Multiple orders per client supported via `listOrders(clientId)`.
- `src/lib/ops-store.ts` helpers: `listClients`, `getClient`, `createClient`, `primaryPhone`, `primaryEmail`, `formatAddress`.
- No changes made — existing client functionality verified working and preserved.

### Order management
- `PATCH /api/orders/[id]` — general non-financial update (rtoContactId, rtoContactName, notes) with history + audit. Financial snapshots (sellingPrice, supplierCostSnapshot, currency, priceListId, etc.) are immutable and excluded from updates.
- Order creation now validates:
  - Qualification–RTO mapping exists and is active (`NO_QUALIFICATION_RTO_MAPPING`, 400).
  - Supplier route exists for the qualification/sourceAgent/RTO combination (`NO_ACTIVE_SUPPLIER_ROUTE`, 400).
- Order captures optional RTO contact (`rtoContactId`, `rtoContactName`) at creation.
- Server-side pricing snapshot preserved (Phase 2): priceCategoryId, priceListId, supplierRouteId, exchangeRate, convertedAmount, additionalFees, feeTotal, currency.
- Order detail page (`src/views/order-detail.tsx`) displays RTO contact, RTO processing record, licensing & certificate delivery fields, commercials, invoices/payments, workflow tasks, status history.

### Document and evidence management
- Document access-log writes added on upload (`POST /api/documents/upload`) and download (`GET /api/documents/[id]/download`) via new `writeDocumentAccessLog` helper, recording actorId, action, ip, requestId.
- Existing document module preserved: multipart upload, versioning (supersedes prior), download (no public URLs), approve/reject with reason, access-log read route.
- Document checklist status tracked per document (Received/Under Review/Approved/Rejected/Superseded).

### Workflow task management
- Overdue detection added to `GET /api/workflow/tasks` (computed `overdue` flag when dueDate < now and status !== Done).
- Frontend task board shows overdue badge.
- Existing create/patch/list preserved with history + audit.

### RTO processing management (new)
- New collection `rto-processing`: orderId, rtoId, submissionStatus, submissionDate, processingStatus, rtoReference, processingFees, processingCurrency, notes, history, timestamps.
- `GET/POST /api/rto-processing` — list (filter by orderId/status, pagination) + create.
- `GET/PATCH/DELETE /api/rto-processing/[id]` — get, update (with history), delete.
- One processing record per order (409 CONFLICT on duplicate).
- Validates order and RTO existence (404).
- Frontend page `src/views/rto-processing.tsx` + route page, guarded by `rto.manage`.
- Nav entry: "RTO Processing".

### Assessment, licensing and certificate tracking
- Order extended with licensing fields: `licensingAuthority`, `licenceReference`, `licenceExpiry`.
- Order extended with certificate delivery fields: `certificateDeliveryMethod`, `certificateDeliveryDate`, `certificateTrackingNumber`.
- `PATCH /api/orders/[id]/dimensions` extended to update licensing + delivery fields with history + audit.
- Order detail page shows licensing & certificate delivery section.

### Types (`src/lib/types.ts`)
- `Order`: added `rtoContactId`, `rtoContactName`, `licensingAuthority`, `licenceReference`, `licenceExpiry`, `certificateDeliveryMethod`, `certificateDeliveryDate`, `certificateTrackingNumber`.
- New types: `RtoProcessing`, `RtoProcessingStatus`, `DocumentAccessLog`, `DocumentAccessLogInput`.
- `WorkflowTask`: added optional `overdue`.
- `currency` widened to `Currency` union (Phase 2, preserved).

### Data-access store (`src/lib/ops-store.ts`)
- Added `listRtoProcessing`, `createRtoProcessing`, `updateRtoProcessing`, `deleteRtoProcessing`.
- Added `RtoProcessing` type import.

### API client (`src/lib/api.ts`)
- Added `api.delete` method.

### API audit helper (`src/lib/audit.ts`)
- Added `writeDocumentAccessLog` for upload/download access tracing.

---

## Database changes

**New collection:** `rto-processing` (one record per order).

**Indexes:** unique `rto-processing(orderId)` (one processing record per order). Created via idempotent migration script (extended from Phase 1/2).

**Document access logs:** `document_access_logs` collection now written on upload/download (collection pre-existed, was read-only).

No existing collections modified or duplicated. Additive changes only.

---

## API routes changed or added

**Changed:**
- `src/app/api/orders/[id]/route.ts` — added PATCH (non-financial fields + audit).
- `src/app/api/orders/route.ts` — POST validates qualification–RTO mapping + supplier route compatibility; captures rtoContactId/rtoContactName.
- `src/app/api/orders/[id]/dimensions/route.ts` — extended to licensing + certificate delivery fields.
- `src/app/api/documents/upload/route.ts` — writes upload access log.
- `src/app/api/documents/[id]/download/route.ts` — writes download access log.
- `src/app/api/workflow/tasks/route.ts` — GET computes `overdue` flag.
- `src/lib/api.ts` — added `api.delete`.
- `src/lib/audit.ts` — added `writeDocumentAccessLog`.
- `src/lib/store.ts` — added `orderLabel`, `Order` import.

**Added:**
- `src/app/api/rto-processing/route.ts` — GET/POST.
- `src/app/api/rto-processing/[id]/route.ts` — GET/PATCH/DELETE.

---

## Frontend changes

- `src/views/rto-processing.tsx` — new RTO processing page (create/edit/remove, filters, currency picker).
- `src/app/(app)/rto-processing/page.tsx` — route page with `rto.manage` guard.
- `src/views/order-detail.tsx` — RTO contact, RTO processing, licensing & certificate delivery sections.
- `src/views/tasks.tsx` — overdue badge on task board.
- `src/components/layout/nav.ts` — added "RTO Processing" nav item (Operations section).

---

## Workflow changes

- Task overdue flag computed server-side; badge shown in UI.
- RTO processing history tracked on status/field changes.
- Order non-financial updates tracked in order history + audit.

---

## Tests executed and results

`tests/phase-3.test.ts` — 8 tests:
- Client create + duplicate email prevention (409).
- Client list with search.
- Multiple orders per client.
- Order rejected when qualification–RTO mapping missing (400).
- Order allowed when mapping exists.
- Order preserves selling price + supplier cost snapshot.
- RTO processing create + list by order.
- Duplicate RTO processing record prevention (409).

`tests/phase-0.test.ts` (16) and `tests/phase-1.test.ts` (19) and `tests/phase-2.test.ts` (17) re-run — all pass (no regression; updated to seed qualification–RTO mappings reflecting the new order-validation requirement).

```
Test Files  4 passed (4)
Tests       60 passed (60)
```
Each vitest worker uses a unique test database (`skills_connect_admin_test_<hash>`).

---

## TypeScript, lint and build results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `tsc --noEmit` | PASS |
| Lint | `oxlint` | PASS (pre-existing warnings only) |
| Production build | `next build` | PASS |
| Tests | `vitest run` | 60/60 PASS |

---

## Remaining issues

- Per-qualification document checklist is still a static default (`DOC_CHECKLISTS.default`); a configurable per-qualification checklist stored in DB is a future enhancement.
- Workflow comments/activity text (beyond status history) not implemented — marked "if appropriate" in requirements.
- Configurable workflow stages per qualification not implemented (status matrix remains shared).
- Real FX exchange-rate source not configured (placeholder rate = 1) — carried from Phase 2.
- Commission eligibility criteria not finalized (carried from Phase 2).

---

## Phase completion status

**Phase 3 — Client, Order & Operational Management: Complete.** All confirmed requirements implemented, tests passing (60/60), typecheck/lint/build green, no regressions. Historical financial snapshots preserved; additive schema changes only. Do not begin Phase 4.
