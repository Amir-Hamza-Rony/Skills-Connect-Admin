# Phase 2 — Price List & Monthly Agent Commission Implementation Plan

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Status:** Complete — all milestones implemented, committed (`4d79822`), and verified.  
**Plan nature:** Retrospective record of the completed Phase 2 implementation, reflecting actual code.

---

## Milestone M2.1 — Types, currency & permissions

**Objectives:** Add Phase 2 domain types, widen `currency` from `"AUD"` literal to `Currency` union, add `commissions.manage`/`commissions.view` permissions.

**Features:** `Currency` union (AUD, BDT, USD, GBP, EUR, INR); `PriceCategory`, `PriceList`, `AdditionalFee`, `AgentCommissionRule`, `CommissionTier`, `CommissionRecord`, `CommissionPayout` types + status enums; `Order` extended with pricing snapshot fields; `SupplierRoute.currency` widened.

**Backend/API:** Type definitions in `src/lib/types.ts`; `Permission` type extended.

**Frontend:** None (type-only).

**Database/model:** No schema change (type-only).

**Security:** No new exposure.

**Dependencies:** Phase 0/1 types.

**Test cases:** Typecheck passes (`tsc --noEmit`).

**Acceptance criteria:** `Order.currency` and `SupplierRoute.currency` accept `Currency` union; new types compile; `commissions.manage`/`commissions.view` in `Permission` type.

**Documentation:** `docs/phase-2-pricing-commission-audit.md`, `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.2 — Price Category management

**Objectives:** CRUD for price categories with code normalization, dedupe, active/inactive status.

**Features:** `GET/POST /api/masters/price-categories`, `PATCH/DELETE /api/masters/price-categories/[id]`; uppercase code normalization; duplicate code prevention (409 `CONFLICT`); active/inactive status; initial codes FLOOR/STANDARD/SPECIAL/ONLINE created via UI (not hardcoded).

**Backend/API:** `src/app/api/masters/price-categories/route.ts` + `[id]/route.ts`; `src/lib/store.ts` functions.

**Frontend:** `src/views/price-categories.tsx` — list with status filter, create, edit, activate/deactivate, delete.

**Database/model:** `price_categories` collection; unique index on `code`.

**Security:** `requirePermission` guard; `writeAudit` on mutations.

**Dependencies:** M2.1 types.

**Test cases:** create, code normalization, duplicate prevention, list with status filter (`tests/phase-2.test.ts`).

**Acceptance criteria:** CRUD works; duplicate code returns 409; status toggle works; unique index enforced.

**Documentation:** `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.3 — Qualification Price List management

**Objectives:** CRUD for qualification price lists with currency, effective dates, overlap prevention.

**Features:** `GET/POST /api/masters/price-lists`, `PATCH/DELETE /api/masters/price-lists/[id]`; qualification/category/status filter, pagination; multi-currency per amount; effective start/end dates; draft/inactive/active status; overlapping active period prevention for same qualification + category (409).

**Backend/API:** `src/app/api/masters/price-lists/route.ts` + `[id]/route.ts`; `src/lib/store.ts` functions.

**Frontend:** `src/views/price-lists.tsx` — list with filters, create/edit dialogs, currency picker, effective dates.

**Database/model:** `price_lists` collection; unique compound index on `{qualificationId, priceCategoryId}`.

**Security:** `requirePermission` guard; `writeAudit` on mutations; server-side overlap validation (client cannot bypass).

**Dependencies:** M2.1, M2.2.

**Test cases:** create, currency/effective dates, overlapping period prevention (409), list filtering (`tests/phase-2.test.ts`).

**Acceptance criteria:** CRUD works; overlapping active windows rejected; multi-currency supported; historical data untouched.

**Documentation:** `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.4 — Additional Fees

**Objectives:** CRUD for additional fees with applicability (qualification or price category).

**Features:** `GET/POST /api/masters/additional-fees`; applicability qualification or price category; amount, currency, description, effective dates, optional/mandatory flag, active/inactive status; optional fees NOT automatically applied to every order (no universal fee policy invented).

**Backend/API:** `src/app/api/masters/additional-fees/route.ts`; `src/lib/store.ts` functions.

**Frontend:** `src/views/additional-fees.tsx` — list + create dialog.

**Database/model:** `additional_fees` collection.

**Security:** `requirePermission` guard; `writeAudit` on mutations.

**Dependencies:** M2.1, M2.2.

**Test cases:** create, list filtering by applicability (`tests/phase-2.test.ts`).

**Acceptance criteria:** CRUD works; applicability filtering works; optional fees not auto-applied.

**Documentation:** `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.5 — Order pricing snapshot integration

**Objectives:** Extend `POST /api/orders` to capture an immutable pricing snapshot resolved server-side.

**Features:** qualification reference, selected price category, price list reference, supplier route reference; original selling amount resolved server-side from price list (client-submitted `sellingPrice` only fallback); selling currency (multi-currency); applicable additional fees snapshot + fee total; supplier cost from active supplier route + currency; exchange rate snapshot (placeholder 1) + converted reporting amount; financial calculations server-side; client-submitted totals not trusted; existing orders retain historical values (new fields additive).

**Backend/API:** `src/app/api/orders/route.ts` (POST + GET returns snapshot fields); `src/lib/store.ts` `priceListLabel`.

**Frontend:** Order creation pricing logic server-side (no new client price input trusted).

**Database/model:** `Order` extended with `priceCategoryId`, `priceListId`, `supplierRouteId`, `exchangeRate`, `convertedAmount`, `additionalFees`, `feeTotal`; `currency` widened to `Currency`. Additive only; existing documents unaffected.

**Security:** Server-side price resolution; client cannot set authoritative selling price; financial visibility/ownership restrictions preserved.

**Dependencies:** M2.1–M2.4; Phase 1 order workflow.

**Test cases:** selling price/currency/supplier cost/fee snapshot captured; historical price/supplier cost preserved; priceListId null when no price list (`tests/phase-2.test.ts`).

**Acceptance criteria:** Snapshot captured immutably; server-side resolution; existing orders unchanged; no duplicate records/indexes.

**Documentation:** `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.6 — Agent Commission Rule management

**Objectives:** CRUD for commission rules with tiers, applicability (agent or responsibility), approval workflow.

**Features:** `GET/POST /api/masters/commission-rules`, `PATCH/DELETE /api/masters/commission-rules/[id]`; applicability specific agent OR responsibility (not both); effective dates; tiers (minDeals/maxDeals/commissionPerDeal); commission currency; additional incentive; active/inactive; approval status (draft/approved/rejected), approvedBy/approvedAt; draft by default; example tiers stored as draft/unapproved only.

**Backend/API:** `src/app/api/masters/commission-rules/route.ts` + `[id]/route.ts`; `src/lib/store.ts` functions.

**Frontend:** `src/views/commission-rules.tsx` — tier builder, approval status, draft-only-by-default.

**Database/model:** `agent_commission_rules` collection.

**Security:** `requirePermission` guard; `writeAudit` on mutations; agent-or-responsibility exclusivity (400).

**Dependencies:** M2.1.

**Test cases:** create (draft), agent-or-responsibility exclusivity (400), list filtering by approval status (`tests/phase-2.test.ts`).

**Acceptance criteria:** CRUD works; exclusivity enforced; draft default; example tiers not activated.

**Documentation:** `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.7 — Monthly Commission Calculation framework

**Objectives:** Calculate commission for an agent + period with duplicate prevention.

**Features:** `POST /api/commission-records` (action: calculate); reads approved+active commission rules; eligibility driven by rule's `eligibleOrderStatuses` (no criteria invented); duplicate calculation prevention (one record per agent + period, 409); tier-based commission amount, currency, exchange-rate snapshot, converted amount, additional incentive; records in `calculated` status (not auto-approved/payable); `GET /api/commission-records` list with agent/period/status filter, pagination.

**Backend/API:** `src/app/api/commission-records/route.ts`; `src/lib/store.ts` functions.

**Frontend:** `src/views/commission-records.tsx` (calculate).

**Database/model:** `commission_records` collection; unique compound index on `{agentId, periodMonth, periodYear}`.

**Security:** `requirePermission` guard; `writeAudit` on create; server-side eligibility.

**Dependencies:** M2.6; M2.5 (order data).

**Test cases:** eligible deal count, tier amount (2 × 4000 = 8000), duplicate calculation prevention (409) (`tests/phase-2.test.ts`).

**Acceptance criteria:** Calculation uses only approved+active rules; duplicate prevention enforced; records start `calculated`; no auto-approval.

**Documentation:** `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.8 — Commission Approval and Payout

**Objectives:** Approve/reject commission records and record payouts transaction-safe.

**Features:** `POST /api/commission-records/[id]/approve` (only `calculated`); `POST /api/commission-records/[id]/reject` (required reason); `POST /api/commission-payouts` (only `approved`, duplicate payout prevention 409, MongoDB transaction: payment insert + record status update); payout amount, currency, payment date, reference, paidBy/paidAt; statuses draft → calculated → approved/rejected → paid; no auto-pay; audit logging on create/approve/reject/payout.

**Backend/API:** `src/app/api/commission-records/[id]/approve/route.ts`, `[id]/reject/route.ts`, `src/app/api/commission-payouts/route.ts`; `src/lib/store.ts` functions.

**Frontend:** `src/views/commission-records.tsx` (approve, reject), `src/views/commission-payouts.tsx` (record payout).

**Database/model:** `commission_payouts` collection.

**Security:** `requirePermission` guard; `writeAudit` on all mutations; status transition enforcement; transaction-safe payout.

**Dependencies:** M2.7.

**Test cases:** commission approval (audit record written), payout record + record marked paid (`tests/phase-2.test.ts`).

**Acceptance criteria:** Only `calculated` records approvable; reject requires reason; payout only on `approved`; duplicate payout prevented; transaction-safe; audit trail.

**Documentation:** `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.9 — Frontend integration, nav, permissions

**Objectives:** Wire 6 management areas into nav with server-side permission guards.

**Features:** `src/components/layout/nav.ts` — 6 nav entries (Price Categories, Price Lists, Additional Fees, Commission Rules, Commission Records, Commission Payouts) with permissions; `permissions.ts` `ROUTE_PERMISSIONS` mirror; `RequirePermission` server-side guards on all pages.

**Backend/API:** None.

**Frontend:** All 6 views + nav updates.

**Database/model:** None.

**Security:** Server-side `RequirePermission` guards; UI permission mirrors.

**Dependencies:** M2.2–M2.8.

**Test cases:** Build passes; pages render under correct permissions (covered by build + phase tests).

**Acceptance criteria:** 6 nav items with correct permissions; server-side guards on all pages; no client-only enforcement.

**Documentation:** `docs/phase-2-implementation-report.md`.

**Status:** COMPLETE (committed in `4d79822`).

---

## Milestone M2.10 — Testing, verification & documentation

**Objectives:** Full test suite, typecheck, lint, build, Phase 1 regression.

**Features:** `tests/phase-2.test.ts` (17 tests) + re-run `tests/phase-0.test.ts` (16) + `tests/phase-1.test.ts` (19); typecheck; lint; production build.

**Backend/API:** None new.

**Frontend:** None new.

**Database/model:** None new.

**Security:** Authorization/RBAC and API security tests included.

**Dependencies:** All prior milestones.

**Test cases:** All 194 tests across 15 files.

**Acceptance criteria:** 194/194 pass; typecheck PASS; lint PASS (warnings only); build PASS; no Phase 1 regression.

**Documentation:** `docs/phase-2-audit.md`, `docs/phase-2-implementation-plan.md`, `docs/PHASE-2-FINAL-REPORT.md`.

**Status:** COMPLETE.

---

## Verification results (final)

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `tsc --noEmit` | PASS |
| Lint | `oxlint` | PASS (pre-existing warnings only) |
| Production build | `next build` | PASS |
| Tests | `vitest run` | 194/194 PASS (15 files) |

## Business rules requiring management approval (left unapproved/configurable)

1. Exact order eligibility criteria (closure, payment collection, certificate issued).
2. Exclusion of cancelled/refunded orders.
3. Flat-per-deal vs incremental band tiers.
4. Commission currency vs multi-currency sale conversion and FX source.
5. Above-standard sale incentive criteria.
6. Which roles approve rules/payouts.

Example tiers (BDT 4,000 / 6,000 / 8,000 per deal) stored as draft/unapproved only, not activated as production rules.

## Known gaps (documented, not blocking)

- Real FX exchange-rate source not configured (placeholder rate = 1).
- Commission eligibility criteria not finalized; `eligibleOrderStatuses: ["Completed"]` used as configurable default.
- Reject commission record uses a direct `fetch` in frontend (store function not yet added) — functional but inconsistent with store pattern.
- No seed data for price categories/commission rules; created via UI per environment.
- Master-data mutation audit coverage present for pricing/commission routes but not extended to generic master routes.
