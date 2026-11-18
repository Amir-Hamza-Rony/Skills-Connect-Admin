# Phase 3 — RPL Partner Management, RTO Accreditation & Certificate Delivery Implementation Plan

**Project:** Skills Connect Admin
**Branch:** `rony-dev`
**Status:** All milestones complete — implementation complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 205 tests PASS.
**Baseline:** Phases 0, 1, 2 complete. 194 tests pass. All checks green.

---

## Milestone M3.1 — Phase 3 Audit & Architecture (this document)

**Objectives:** Inspect existing codebase, identify gaps vs Phase 3 requirements, produce audit + plan.

**Features:** Audit document + implementation plan.

**Backend/API:** None.

**Frontend/UI:** None.

**Database/model:** None (planning only).

**Security:** Identify permission needs (`rplPartners.manage`, `rplPartners.view`).

**Dependencies:** None.

**Test cases:** N/A.

**Acceptance criteria:** `docs/phase-3-audit.md` and `docs/phase-3-implementation-plan.md` created.

**Documentation:** `docs/phase-3-audit.md`, `docs/phase-3-implementation-plan.md`.

**Status:** COMPLETE (this document). — RPL Partner Data Model & APIs

**Objectives:** Create RPL Partner management module with CRUD, duplicate code prevention, audit logging.

**Features:**
- `RplPartner` type + `RplPartnerStatus` union in `src/lib/types.ts`
- `rplPartners.manage`, `rplPartners.view` permissions in `Permission` type
- `rpl_partners` collection with unique index on `partnerCode`
- `GET/POST /api/rpl-partners` — list (search/pagination/status filter) + create
- `GET/PATCH/DELETE /api/rpl-partners/[id]` — get + update + delete
- Duplicate partner code prevention (409 `CONFLICT`)
- Code normalization (uppercase)
- Active/inactive status
- Audit logging via `writeAudit` on all mutations

**Backend/API:**
- `src/app/api/rpl-partners/route.ts` (new)
- `src/app/api/rpl-partners/[id]/route.ts` (new)
- `src/lib/store.ts` — add `listRplPartners`, `createRplPartner`, `updateRplPartner`, `deleteRplPartner`, `rplPartnerLabel`
- `src/lib/types.ts` — add `RplPartner`, `RplPartnerStatus`, permissions

**Frontend/UI:** None (page in M3.7).

**Database/model:** New `rpl_partners` collection; unique index on `partnerCode`; idempotent migration via existing migration script pattern.

**Security:** `requirePermission("rplPartners.manage")` on mutations; `requirePermission("rplPartners.view")` on list/get; SUPER_ADMIN bypass.

**Dependencies:** M3.1 types/permissions.

**Test cases:** create partner, code normalization, duplicate prevention (409), list with search/status filter, get by id, update, delete, inactive status, unauthorized access (403).

**Acceptance criteria:** CRUD works; duplicate partnerCode returns 409; inactive partners can be deactivated/reactivated; unique index enforced; audit records written.

**Documentation:** `docs/phase-3-implementation-plan.md`, `docs/PHASE-3-FINAL-REPORT.md`.

**Status:** COMPLETE.

---

## Milestone M3.3 — Partner Assignment

**Objectives:** Link RPL partners to orders with validation.

**Features:**
- Optional `rplPartnerId` on `Order` type (additive, backward-compatible)
- Order creation: optional `rplPartnerId` — if provided, validate partner exists and is active (400 if invalid/inactive)
- Preserve historical partner references (existing orders keep null or existing value)
- Server-side validation on order creation

**Backend/API:**
- `src/lib/types.ts` — extend `Order` with optional `rplPartnerId`
- `src/app/api/orders/route.ts` (POST) — add `rplPartnerId` validation

**Frontend/UI:** Partner selection on order creation (M3.7).

**Database/model:** Additive `rplPartnerId` field on orders (optional).

**Security:** Partner access follows order access rules (`checkOrderAccess`).

**Dependencies:** M3.2 (rpl_partners collection).

**Test cases:** order with valid active partner succeeds; order with inactive partner rejected (400); order with nonexistent partner rejected (400); order without partner still works (backward-compatible).

**Acceptance criteria:** Active partner assignment allowed; inactive/invalid partner rejected; existing orders unaffected.

**Documentation:** `docs/phase-3-implementation-plan.md`.

**Status:** COMPLETE.

---

## Milestone M3.4 — RTO Accreditation Management

**Objectives:** Extend existing RTO model with accreditation information.

**Features:**
- Extend `Rto` type with optional accreditation fields: `accreditationNumber`, `accreditationBody`, `accreditationExpiry`, `lastAuditDate`, `accreditationStatus`, `supportingDocumentIds`, `notes`
- Extend masters `[type]` route for `rtos` to handle accreditation fields on create/update
- Accreditation status: `accredited`, `expired`, `expiring`, `pending`, `suspended`
- Expiry date tracking; display expired/expiring indicators
- No auto-deactivation on expiry (business decision deferred)
- Preserve existing RTO data (all fields optional)

**Backend/API:**
- `src/lib/types.ts` — extend `Rto` with accreditation fields; add `RtoAccreditationStatus` union
- `src/app/api/masters/[type]/route.ts` — add `rtos` accreditation field handling in POST
- `src/app/api/masters/[type]/[id]/route.ts` — add `rtos` accreditation field handling in PATCH
- `src/lib/store.ts` — update `updateRto` pick to include accreditation fields

**Frontend/UI:** RTO page accreditation fields (M3.7).

**Database/model:** Additive optional fields on `rtos` documents.

**Security:** `rto.manage` permission (existing).

**Dependencies:** Existing RTO infrastructure.

**Test cases:** RTO create with accreditation fields, RTO update accreditation, accreditation status computation (expired/expiring), existing RTO without accreditation fields still valid.

**Acceptance criteria:** Accreditation fields stored/retrieved; expired/expiring status computed; backward-compatible with existing RTO records.

**Documentation:** `docs/phase-3-implementation-plan.md`.

**Status:** COMPLETE.

---

## Milestone M3.5 — Certificate File Management

**Objectives:** Implement certificate file upload and secure retrieval, reusing existing documents infrastructure.

**Features:**
- Certificate file upload API (`POST /api/certificates/[id]/upload`) — reuse documents multipart upload pattern
- Certificate metadata stored in `certificates` collection (already exists, created on order creation)
- Secure file access — download via authenticated route only, no public URLs
- File validation (MIME types, size)
- Certificate-to-order relationship (certificates already linked to orderId)
- Upload history
- Audit logging for upload/access

**Backend/API:**
- `src/app/api/certificates/[id]/upload/route.ts` (new) — certificate file upload
- `src/app/api/certificates/[id]/download/route.ts` (new) — secure certificate download
- `src/lib/store.ts` — certificate upload/download helpers (or inline in routes)
- Reuse `writeDocumentAccessLog` for access tracking

**Frontend/UI:** Certificate upload on order detail page (M3.7).

**Database/model:** `certificates` collection already exists (additive); may add `fileId`, `fileName`, `contentType`, `sizeBytes`, `uploadedAt`, `uploadedBy` fields.

**Security:** Authenticated download only; no public URLs; `documents.view` or certificate-specific permission.

**Dependencies:** Existing documents upload infrastructure; `certificates` collection.

**Test cases:** certificate upload (valid file), certificate upload (invalid file type rejected), certificate download (authorized), certificate download (unauthorized 403/404), audit record on upload/download.

**Acceptance criteria:** Certificate file can be uploaded and downloaded securely; invalid files rejected; access logged.

**Documentation:** `docs/phase-3-implementation-plan.md`.

**Status:** COMPLETE.

---

## Milestone M3.6 — Certificate Delivery Tracking

**Objectives:** Implement certificate delivery workflow with status tracking.

**Features:**
- `CertificateDelivery` type + `CertificateDeliveryStatus` union in `src/lib/types.ts`
- `certificate_deliveries` collection
- `GET/POST /api/certificate-deliveries` — list (filter by order/status) + create
- `GET/PATCH /api/certificate-deliveries/[id]` — get + update delivery status
- Delivery status transitions: `pending` → `dispatched` → `delivered` → `failed` (with validation)
- Delivery date, recipient, method, tracking number, confirmation details, notes
- Prevent invalid transitions (400)
- Audit logging on create/update

**Backend/API:**
- `src/lib/types.ts` — add `CertificateDelivery`, `CertificateDeliveryStatus`
- `src/app/api/certificate-deliveries/route.ts` (new)
- `src/app/api/certificate-deliveries/[id]/route.ts` (new)
- `src/lib/store.ts` — delivery helpers

**Frontend/UI:** Delivery tracking page (M3.7).

**Database/model:** New `certificate_deliveries` collection; indexes on `orderId`, `deliveryStatus`.

**Security:** Server-side permission checks; delivery updates restricted to authorized roles.

**Dependencies:** Existing `certificates` collection; Order certificate delivery fields.

**Test cases:** create delivery record, list by order/status, invalid transition rejected (400), valid transition accepted, audit record written.

**Acceptance criteria:** Delivery workflow works; invalid transitions blocked; audit trail; backward-compatible with existing Order delivery fields.

**Documentation:** `docs/phase-3-implementation-plan.md`.

**Status:** COMPLETE.

---

## Milestone M3.7 — Frontend Integration & Permissions

**Objectives:** Complete frontend pages, nav integration, server-side route guards.

**Features:**
- RPL Partner Management page (`src/views/rpl-partners.tsx`) — list, create, edit, activate/deactivate
- RTO Accreditation fields in existing RTO page (`src/views/rtos.tsx`) — accreditation form fields, status badges
- Certificate Management on order detail page (`src/views/order-detail.tsx`) — certificate upload/view/download
- Certificate Delivery Tracking page (`src/views/certificate-deliveries.tsx`) — delivery list, status updates
- Nav entries: "RPL Partners", "Certificate Deliveries" (under Operations/Management)
- `RequirePermission` server-side guards on all new route pages
- `ROUTE_PERMISSIONS` updates in `permissions.ts`

**Backend/API:** Route pages under `src/app/(app)/rpl-partners/page.tsx`, `src/app/(app)/certificate-deliveries/page.tsx` with `RequirePermission`.

**Frontend/UI:** New views + updated RTO page + order detail certificate section.

**Database/model:** None.

**Security:** Server-side `RequirePermission` guards; UI permission mirrors in `ROUTE_PERMISSIONS`.

**Dependencies:** M3.2–M3.6 APIs.

**Test cases:** Build passes; pages render; permission guards present (verified via build + code inspection).

**Acceptance criteria:** All new pages accessible only with correct permissions; nav entries present; forms functional.

**Documentation:** `docs/phase-3-implementation-plan.md`.

**Status:** COMPLETE.

---

## Milestone M3.8 — Integration & Regression Testing

**Objectives:** Full test suite, typecheck, lint, build; verify no regressions.

**Features:**
- `tests/phase-3.test.ts` — RPL partner CRUD, duplicate prevention, inactive partner rejection, RTO accreditation, certificate upload/download, delivery workflow, order partner assignment
- Re-run `tests/phase-0.test.ts`, `tests/phase-1.test.ts`, `tests/phase-2.test.ts` — no regression

**Test cases:** All Phase 3 feature tests + full regression.

**Acceptance criteria:** All tests pass; typecheck PASS; lint PASS; build PASS; no Phase 0/1/2 regression.

**Status:** COMPLETE.

---

## Milestone M3.9 — Final Documentation & GitHub Delivery

**Objectives:** Update docs, create final report, commit and push.

**Features:**
- Update `docs/phase-3-audit.md` with actual results
- Update `docs/phase-3-implementation-plan.md` with actual results
- Create `docs/PHASE-3-FINAL-REPORT.md`
- Commit verified changes to `rony-dev`
- Push to `origin/rony-dev`

**Acceptance criteria:** All docs created; commits pushed; working tree clean.

**Status:** COMPLETE.

---

## Milestone M3.10 — Final Phase 3 Integration Audit

**Objectives:** Read-only final audit after implementation.

**Verification:**
- No Phase 0/1/2 regression
- All 21 `OrderStatus` values preserved
- Exact `ALLOWED_TRANSITIONS` preserved
- All five protected M0 helpers unchanged
- Existing `clients`/`orders` architecture preserved
- No unauthorized access introduced
- No destructive database changes
- No fake frontend functionality
- No secrets exposed

**Status:** COMPLETE.

---

## Verification targets (actual results)

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `tsc --noEmit` | PASS |
| Lint | `oxlint` | PASS (pre-existing warnings only) |
| Build | `next build` | PASS |
| Tests | `vitest run` | 205/205 PASS (15 files) |

## Regression results

- Phase 0: PASS (no regression)
- Phase 1: PASS (no regression)
- Phase 2: PASS (no regression)

## Business decisions unresolved (documented, not blocking)

1. **Multiple partners per order** → Single `rplPartnerId` on Order (one partner per order); cardinality documented as confirmed-safe behavior.
2. **Certificate delivery confirmation** → Manual tracking workflow (delivery date, recipient, method, tracking number, notes); no external courier integration.
3. **RTO accreditation expiry enforcement** → Track expiry dates and display warnings; do NOT auto-deactivate without approved business rule.

## Migration scripts

Idempotent migration via existing pattern:
- Create `rpl_partners` collection with unique index on `partnerCode`
- Create `certificate_deliveries` collection with indexes on `orderId`, `deliveryStatus`
- No existing collections modified or dropped
