# Phase 2 — Price List & Monthly Agent Commission Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-03  
**Baseline:** Phase 0 & Phase 1 complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 35 tests PASS (16 Phase 0 + 19 Phase 1).

---

## Existing implementation

### Order pricing (current)

`src/app/api/orders/route.ts` — `POST /api/orders`:
- Captures `sellingPrice` from client input (number, no currency sent).
- Captures `supplierCostSnapshot` server-side from the active supplier route (`qualificationId` + `sourceAgentId` + `rtoId`, status `active`, effective date window).
- `otherCost` defaults to 0.
- `currency` hardcoded to `"AUD"`.
- Order type `Order.currency` is typed as `"AUD"` (literal, not union).
- Audit record written on create via `writeAudit`.

**Gap:** No price category, no price-list reference, no fee snapshot, no exchange rate, no converted amount, no currency flexibility.

### Supplier routes (current)

`src/app/api/masters/[type]/route.ts` + `src/views/pricing.tsx`:
- `wholesaleCost`, `currency: "AUD"` (literal), `effectiveFrom`, `effectiveTo`, `status: active|expired`.
- Duplicate active overlapping-window prevention (409).
- Expiry preserves history (never deletes).

### Agents (current)

`Agent.type`: `sales_closing` | `certificate_source` | `rto_contact` (single responsibility).
- `commissionRule` is a free-text string — no structured tiers, no effective dates, no approval status.
- No commission calculation, records, or payouts exist.

### Qualifications / RTOs / Mappings (Phase 1)
- `qualifications`, `rtos`, `qualification-rto-mappings` collections exist with validation, dedupe, indexes.

### Permissions (current)
- `pricing.manage`, `finance.manage`, `qualifications.manage`, `agents.manage`, `rto.manage`, `orders.manage` exist.
- `ROUTE_PERMISSIONS` maps `/pricing` → `pricing.manage`, `/finance` → `finance.manage`, etc.
- `ROLE_PERMISSIONS` matrix assigns these to roles.

### Audit logging (Phase 0)
- `src/lib/audit.ts` `writeAudit({actorId, actorEmail, entityType, entityId, action, before, after})` — writes to `audit_logs`, redacts secrets, failures swallowed.

### Collections confirmed present
`qualifications`, `rtos`, `agents`, `supplier-routes`, `qualification-rto-mappings`, `orders`, `clients`, `invoices`, `payments`, `audit_logs`, `refresh_tokens`, `users`, `roles`.

**Collections NOT present:** `price_categories`, `price_lists`, `agent_commission_rules`, `commission_records`, `commission_payouts`.

### Types (`src/lib/types.ts`)
- `Order.currency: "AUD"` (literal — must become a currency union for Phase 2).
- `SupplierRoute.currency: "AUD"` (literal — must become a currency union).
- No `PriceCategory`, `PriceList`, `AdditionalFee`, `AgentCommissionRule`, `CommissionRecord`, `CommissionPayout` types.
- `Permission` type does not include `commissions.manage` or `commissions.view`.

---

## Missing functionality (Phase 2 scope)

| Area | Gap |
|------|-----|
| Price categories | No `price_categories` collection; no CRUD; four required categories (Floor/Standard/Special/Online) not defined. |
| Qualification price lists | No `price_lists` collection; selling price is client-submitted on order, not looked up from a price list. |
| Additional fees | No `additional_fees` collection; no fee concept at all. |
| Order pricing snapshot | Order stores only `sellingPrice`/`supplierCostSnapshot`/`otherCost`/`currency:AUD`. Missing: price category, selling currency, fee snapshot, supplier route ref, price-list ref, exchange rate, converted amount. |
| Agent commission rules | `commissionRule` string only; no structured tiers, dates, currency, or approval status. |
| Monthly commission calculation | No `commission_records`; no calculation framework; no duplicate prevention. |
| Commission approval/payout | No `commission_payouts`; no approve/reject/payout flow. |
| Permissions | No `commissions.manage` / `commissions.view` permission. |
| Types/currency | `currency` typed as `"AUD"` literal on Order and SupplierRoute; multi-currency not supported. |

---

## Proposed data structure

### `price_categories`
`{ _id, code, name, description, status (active|inactive), createdAt, updatedAt }`
Unique index on `code`. Initial codes: `FLOOR`, `STANDARD`, `SPECIAL`, `ONLINE`.

### `price_lists`
`{ _id, qualificationId, priceCategoryId, amount, currency, effectiveFrom, effectiveTo, status (active|inactive|draft), createdAt, updatedAt }`
Unique compound index on `{qualificationId, priceCategoryId}` to prevent duplicate active periods; overlapping effective-window validation.

### `additional_fees`
`{ _id, qualificationId (optional), priceCategoryId (optional), amount, currency, description, effectiveFrom, status, isOptional (boolean), createdAt, updatedAt }`

### `agent_commission_rules`
`{ _id, agentId (optional — null means applies to all agents of a responsibility), responsibility (sales_closing|null), effectiveFrom, effectiveTo, tiers: [{minDeals, maxDeals, commissionPerDeal}], commissionCurrency, additionalIncentiveAmount, additionalIncentiveCurrency, status (active|inactive), approvalStatus (draft|approved|rejected), approvedBy, approvedAt, createdAt, updatedAt }`

### `commission_records`
`{ _id, agentId, periodMonth, periodYear, eligibleDealCount, eligibleDealIds[], tierApplied (or null), commissionAmount, commissionCurrency, exchangeRate (optional), convertedAmount (optional), additionalIncentiveAmount, status (draft|calculated|approved|rejected|paid), calculatedBy, calculatedAt, approvedBy, approvedAt, createdAt, updatedAt }`
Unique compound index on `{agentId, periodMonth, periodYear}` to prevent duplicate calculations.

### `commission_payouts`
`{ _id, commissionRecordId, amount, currency, paymentDate, paymentReference, status (pending|paid|failed), paidBy, paidAt, createdAt, updatedAt }`

---

## Pricing relationships

- Qualification → (many) PriceLists, each tied to a PriceCategory.
- PriceCategory → (many) PriceLists, (many) AdditionalFees.
- Order → references one PriceList (snapshot), one PriceCategory (snapshot), supplier cost snapshot (from SupplierRoute), additional fees snapshot.
- SupplierRoute → wholesale cost (separate from client selling price).
- Agent → (many) CommissionRules (or responsibility-based rules).
- CommissionRecord → agent, period, deal IDs, rule used, amounts.
- CommissionPayout → commission record.

Client selling price (price list) ≠ supplier cost (supplier route). Kept in separate collections; never merged.

---

## Commission calculation dependencies

- Commission rules must exist and be `approvalStatus: "approved"` and `status: "active"` for the calculation period.
- Eligibility criteria (what makes an order eligible: closure? payment collected? excluded cancelled/refunded?) — **requires management confirmation** (see below).
- Tier structure (flat per-deal vs incremental bands) — **requires management confirmation**.
- Commission currency vs multi-currency sales — **requires management confirmation**.
- Exchange rates for conversion — source to be configured.

---

## Business rules requiring management confirmation

1. What makes an order eligible for commission? (order status closure, payment collection, certificate issued, etc.)
2. Are cancelled or refunded orders excluded from eligible deal counts?
3. Is the tier flat per-deal within the band, or incremental per band?
4. Which currency is commission paid in, and how are multi-currency sales converted?
5. What constitutes the "above-standard sale" incentive and when does it apply?
6. Who approves commission rules and payouts (which roles)?

Until confirmed: store example tiers as **draft/unapproved** only; do not activate; do not calculate payable commission using unapproved assumptions.

---

## Migration risks

- DB may have existing orders with `currency: "AUD"` and no price snapshot fields. Changing `Order.currency` type from `"AUD"` literal to a currency union is backwards-compatible for existing data (AUD is a valid currency).
- No seed data for price categories/commission rules — initial data must be seeded or created via UI.
- Changing order creation to require a price-list lookup could break order creation if no price list exists for the qualification/category — must handle gracefully (allow order without price-list reference, or require it based on policy).
- Existing `commissionRule` string on agents is not migrated to structured rules (keep as-is; new structured rules are additive).

---

## Implementation sequence

1. **Audit document** (this file).
2. **Types** — add `PriceCategory`, `PriceList`, `AdditionalFee`, `AgentCommissionRule`, `CommissionRecord`, `CommissionPayout`; widen `currency` to a union; add `commissions.manage`/`commissions.view` permissions.
3. **Price Categories** — API routes + UI (CRUD, dedupe, status).
4. **Price Lists** — API routes + UI (CRUD, overlap prevention, currency, effective dates).
5. **Additional Fees** — API routes + UI.
6. **Order pricing snapshot** — extend `POST /api/orders` to capture price category, selling currency, fees, supplier route ref, price-list ref, exchange rate, converted amount.
7. **Commission rules** — API routes + UI (CRUD, tiers, approval status, draft only).
8. **Commission calculation** — monthly framework, duplicate prevention, draft records.
9. **Commission approval & payout** — approve/reject/payout flow.
10. **Frontend integration** — 6 management areas, nav, permissions.
11. **Tests** — pricing + commission CRUD, dedupe, overlap, snapshots, permissions, calculation.
12. **Verification** — typecheck, lint, build.
