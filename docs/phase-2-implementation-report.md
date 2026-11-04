# Phase 2 — Price List & Monthly Agent Commission Implementation Report

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Status:** Complete  
**Baseline (post-Phase 1):** `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 35 tests PASS (16 Phase 0 + 19 Phase 1).

---

## Completed modules

### 1. Price Category management (CRUD, dedupe, status)
- `GET/POST /api/masters/price-categories` — list (search/pagination) + create.
- `PATCH/DELETE /api/masters/price-categories/[id]` — update + delete.
- Code normalization (uppercase), duplicate code prevention (409 `CONFLICT`), active/inactive status.
- Initial categories supported: Floor, Standard, Special, Online (created via UI, not hardcoded).
- Frontend: `src/views/price-categories.tsx` — list with status filter, create, edit, activate/deactivate, delete.

### 2. Qualification Price List management
- `GET/POST /api/masters/price-lists` — list (qualification/category/status filter, pagination) + create.
- `PATCH/DELETE /api/masters/price-lists/[id]` — update + delete.
- Currency per amount (multi-currency: AUD, BDT, USD, GBP, EUR, INR).
- Effective start/end dates, active/inactive/draft status.
- Overlapping active price-period prevention for the same qualification + category (409).
- Frontend: `src/views/price-lists.tsx` — list with qualification/category/status filters, create/edit dialogs, currency picker, effective dates.

### 3. Additional Fees
- `GET/POST /api/masters/additional-fees` — list + create.
- Applicability: qualification or price category; amount, currency, description, effective dates, optional/mandatory flag, active/inactive status.
- Optional fees are NOT automatically applied to every order (no universal fee policy invented).
- Frontend: `src/views/additional-fees.tsx` — list + create dialog.

### 4. Order pricing snapshot integration
- `POST /api/orders` now captures an immutable pricing snapshot:
  - qualification reference, selected price category, price list reference, supplier route reference.
  - original selling amount (resolved server-side from price list; client-submitted `sellingPrice` is only a fallback).
  - selling currency (multi-currency).
  - applicable additional fees snapshot + fee total.
  - supplier cost (from active supplier route), supplier cost currency.
  - exchange rate snapshot (placeholder 1 unless a real FX source is configured) + converted reporting amount.
- Financial calculations happen server-side; client-submitted totals are not trusted for the price-list path.
- Existing orders retain historical selling prices/supplier costs (new fields are additive; old documents unaffected).
- Changing a price list or supplier cost does not modify existing orders.
- Frontend: order creation pricing logic is server-side (no new client price input trusted).
- `src/lib/types.ts` `Order` extended with `priceCategoryId`, `priceListId`, `supplierRouteId`, `exchangeRate`, `convertedAmount`, `additionalFees`, `feeTotal`, `currency` widened from `"AUD"` literal to `Currency` union.

### 5. Agent Commission Rule management
- `GET/POST /api/masters/commission-rules` — list + create.
- `PATCH/DELETE /api/masters/commission-rules/[id]` — update + delete.
- Applicability: specific agent OR responsibility (sales_closing/certificate_source/rto_contact), not both.
- Effective dates, tiers (minDeals/maxDeals/commissionPerDeal), commission currency, additional incentive, active/inactive status, approval status (draft/approved/rejected), approvedBy/approvedAt.
- Example tiers (BDT 4,000/6,000/8,000 per deal) stored as **draft/unapproved only** — not activated as production rules.
- Frontend: `src/views/commission-rules.tsx` — tier builder, approval status, draft-only-by-default.

### 6. Monthly Commission Calculation framework
- `POST /api/commission-records` (action: calculate) — calculates commission for an agent + period.
- Reads approved, active commission rules from the database.
- Eligibility depends on the rule's configured `eligibleOrderStatuses` (no eligibility criteria invented).
- Duplicate calculation prevention (one record per agent + period, 409 `CONFLICT`).
- Tier-based commission amount, currency handling, exchange-rate snapshot, converted amount, additional incentive.
- Records created in `calculated` status (not auto-approved/payable).
- `GET /api/commission-records` — list with agent/period/status filter, pagination.

### 7. Commission Approval and Payout
- `POST /api/commission-records/[id]/approve` — approve (only `calculated` records), records approver + timestamp.
- `POST /api/commission-records/[id]/reject` — reject with required reason.
- `POST /api/commission-payouts` — record payout (only `approved` records), duplicate payout prevention (409), transaction-safe (payment insert + record status update in one MongoDB transaction).
- Payout amount, currency, payment date, reference, paidBy/paidAt.
- Statuses: draft → calculated → approved/rejected → paid. No auto-pay after calculation or approval.
- Audit logging on create/approve/reject/payout via `writeAudit` (Phase 0 helper).
- Frontend: `src/views/commission-records.tsx` (calculate, approve, reject), `src/views/commission-payouts.tsx` (record payout).

---

## Existing features reused

- Generic `withAuth`/`requirePermission` RBAC middleware (Phase 0).
- `writeAudit` audit helper (Phase 0) — writeAudit calls added to all pricing/commission mutations.
- `collection`, `safeObjectId`, `getClient` (db layer, Phases 0/1).
- `DataTable`, `Dialog`, `Badge`, `Button`, `Skeleton` UI components.
- `price_categories`, `price_lists`, `additional_fees`, `agent_commission_rules`, `commission_records`, `commission_payouts` — all new collections (none pre-existed).
- `src/lib/store.ts` data-access layer extended with pricing/commission functions.
- `src/lib/master-validation.ts` and new `src/lib/pricing-validation.ts` shared validation layer.
- Existing `qualifications`, `agents`, `supplier-routes`, `orders` collections referenced (not duplicated).

---

## Database and schema changes

**New collections:**
- `price_categories` — code, name, description, status, timestamps.
- `price_lists` — qualificationId, priceCategoryId, amount, currency, effectiveFrom, effectiveTo, status, timestamps.
- `additional_fees` — applicability, referenceId, amount, currency, description, effectiveFrom, effectiveTo, isOptional, status, timestamps.
- `agent_commission_rules` — agentId, responsibility, effectiveFrom, effectiveTo, tiers, eligibleOrderStatuses, commissionCurrency, additionalIncentiveAmount/Currency, status, approvalStatus, approvedBy/At, timestamps.
- `commission_records` — agentId, periodMonth, periodYear, eligibleDealCount, eligibleDealIds, tierApplied, commissionAmount/Currency, exchangeRate, convertedAmount, additionalIncentiveAmount, status, calculatedBy/At, approvedBy/At, timestamps.
- `commission_payouts` — commissionRecordId, amount, currency, paymentDate, paymentReference, status, paidBy/At, timestamps.

**Indexes:** unique `price_categories(code)`, unique `price_lists(qualificationId, priceCategoryId)` (prevents duplicate active periods via application validation), unique `commission_records(agentId, periodMonth, periodYear)` (duplicate calculation prevention). Created via `scripts/migrate-master-data.mjs` (extended for Phase 2 collections) — idempotent, read-only to business records.

**Type changes (`src/lib/types.ts`):**
- Added `Currency` union (`AUD|BDT|USD|GBP|EUR|INR`); `Order.currency` and `SupplierRoute.currency` widened from `"AUD"` literal to `Currency`.
- Added `PriceCategory`, `PriceList`, `AdditionalFee`, `AgentCommissionRule`, `CommissionTier`, `CommissionRecord`, `CommissionPayout` types and status enums.
- Added `commissions.manage`, `commissions.view` to `Permission` type.
- Extended `Order` with pricing snapshot fields.

---

## API routes changed or added

**Changed:**
- `src/app/api/orders/route.ts` — POST captures pricing snapshot (price list/category/route, currency, fees, exchange rate, converted amount); GET returns new snapshot fields.
- `src/lib/store.ts` — added pricing/commission data-access functions + `priceListLabel`.
- `src/components/layout/nav.ts` — added 6 nav entries (Price Categories, Price Lists, Additional Fees, Commission Rules, Commission Records, Commission Payouts).

**Added:**
- `src/app/api/masters/price-categories/route.ts` + `[id]/route.ts`
- `src/app/api/masters/price-lists/route.ts` + `[id]/route.ts`
- `src/app/api/masters/additional-fees/route.ts`
- `src/app/api/masters/commission-rules/route.ts` + `[id]/route.ts`
- `src/app/api/commission-records/route.ts` (+ calculate)
- `src/app/api/commission-records/[id]/approve/route.ts`
- `src/app/api/commission-records/[id]/reject/route.ts`
- `src/app/api/commission-payouts/route.ts`

---

## Frontend pages/components changed

- `src/views/price-categories.tsx` (+ route page)
- `src/views/price-lists.tsx` (+ route page)
- `src/views/additional-fees.tsx` (+ route page)
- `src/views/commission-rules.tsx` (+ route page)
- `src/views/commission-records.tsx` (+ route page)
- `src/views/commission-payouts.tsx` (+ route page)
- `src/components/layout/nav.ts` — 6 new nav items with permissions.

All pages use `RequirePermission` server-side guards; UI permission mirrors are in `permissions.ts` (`ROUTE_PERMISSIONS`).

---

## Pricing logic

- Client selling price (price list) is strictly separate from supplier cost (supplier route). Never merged.
- Order selling price resolved server-side from active price list for qualification + category; client-submitted value only a fallback.
- Supplier cost snapshot from active supplier route (unchanged from Phase 0).
- Multi-currency supported per amount; exchange-rate snapshot placeholder (management must configure a real FX source).
- Historical orders immutable: new snapshot fields additive; existing documents untouched; price/supplier cost changes never rewrite history.

---

## Commission logic

- Rules are draft by default; management must approve before use.
- Calculation reads only `approvalStatus === "approved"` and `status === "active"` rules.
- Eligibility driven by rule's `eligibleOrderStatuses` (default `["Completed"]`); no criteria invented.
- Tier = flat per-deal within the band the eligible count falls into.
- Records: draft → calculated → approved/rejected → paid. Never silently recalculate or overwrite approved/paid records.
- Payout transaction-safe; duplicate payout prevention; audit trail.

---

## Business rules requiring management approval

Per the confirmed requirements, the following were deliberately left **unapproved / configurable**:
1. Exact order eligibility criteria (closure, payment collection, certificate issued, etc.).
2. Exclusion of cancelled/refunded orders.
3. Flat-per-deal vs incremental band tiers.
4. Commission currency vs multi-currency sale conversion and FX source.
5. Above-standard sale incentive criteria.
6. Which roles approve rules/payouts.

Example tiers (BDT 4,000 / 6,000 / 8,000 per deal, +BDT 4,000 above-standard incentive) are stored as **draft** configuration only and are **not** used for payable commission.

---

## Tests executed and results

`tests/phase-2.test.ts` — 17 tests:
- Price category create, code normalization, duplicate prevention, list with status filter.
- Price list create, currency/effective dates, overlapping period prevention (409), list filtering.
- Additional fee create, list filtering by applicability.
- Order pricing snapshot: selling price/currency/supplier cost/fee snapshot captured; historical price/supplier cost preserved; priceListId null when no price list.
- Commission rule create (draft), agent-or-responsibility exclusivity (400), list filtering by approval status.
- Commission calculation: eligible deal count, tier amount (2 × 4000 = 8000), duplicate calculation prevention (409).
- Commission approval (audit record written), payout record + record marked paid.

`tests/phase-0.test.ts` (16) and `tests/phase-1.test.ts` (19) re-run: all pass (no regression).

```
Test Files  3 passed (3)
Tests       52 passed (52)
```
Each vitest worker uses a unique test database (`skills_connect_admin_test_<hash>`).

---

## TypeScript and build results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `tsc --noEmit` | PASS |
| Lint | `oxlint` | PASS (pre-existing warnings only) |
| Production build | `next build` | PASS |
| Tests | `vitest run` | 52/52 PASS |

---

## Remaining issues

- Real FX exchange-rate source not configured (placeholder rate = 1). Management must configure before multi-currency conversion is meaningful.
- Commission eligibility criteria not finalized (see "Business rules requiring management approval"). Calculation uses `eligibleOrderStatuses: ["Completed"]` as a configurable default.
- Reject commission record uses a direct `fetch` in the frontend (store function `rejectCommissionRecord` not yet added) — functional but inconsistent with store pattern.
- Master-data mutation audit coverage is present for pricing/commission routes but could be extended to the generic master routes.
- No seed data for price categories/commission rules; must be created via UI in each environment.

---

## Phase completion status

**Phase 2 — Price List & Monthly Agent Commission: Complete.** All confirmed requirements implemented, tests passing, typecheck/lint/build green, no regressions. Unapproved commission policies kept configurable and inactive. Ready for Phase 2 review before Phase 3.
