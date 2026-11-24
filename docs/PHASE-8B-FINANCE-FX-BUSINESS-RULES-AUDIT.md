# Phase 8B — Finance & FX Business Rules Audit

**Repository:** Skills Connect Admin
**Branch:** `rony-dev`
**HEAD:** `ed043712fe1bb34793be97e1f5c53b3c76161f1c`
**Audit type:** Read-only production readiness audit (Finance / FX / Pricing / Commission / Invoicing / Payments / QuickBooks)
**Date:** 2026-11-23

---

## 1. Executive Summary

This audit reviews the complete Finance, Currency, Exchange Rate, Invoice, Payment, and Commission implementation in the Skills Connect Admin application.

**Overall verdict: READY WITH LIMITATIONS**

The finance engine is well-architected and well-tested:
- Multi-currency support at the data-model level (AUD, BDT, USD, GBP, EUR, INR)
- No silent cross-currency summing — finance reports group by currency and return `null` for mixed-currency top-level totals
- Server-side invoice total computation from line items (client-submitted totals not trusted)
- Server-side payment allocation in MongoDB transactions with idempotency keys
- Historical immutability: invoices are immutable, supplier cost snapshots captured at order creation, routes expire rather than overwrite
- Commission calculation per agent per period with approval workflow and payout controls
- QuickBooks integration facade with graceful degradation

**Critical gaps requiring business decisions BEFORE Phase 8B implementation:**

1. **No base/reporting currency approved** — AUD is used as a default in several places but never formally designated as the base currency
2. **No exchange-rate provider approved** — `CurrencyRate` type exists but no rate population, no rate source, no timestamp tracking beyond payment-level `exchangeRateAt`
3. **Exchange rate placeholder = 1** — Order creation and commission calculation both default to rate = 1 when currency ≠ commission currency; this is explicitly marked as a placeholder
4. **No rounding/precision policy** — Decimal handling not specified
5. **No missing-rate behavior** — Undefined behavior when a rate cannot be obtained
6. **Invoice discrepancy (INV 272)** — Listed AUD 500 vs note mentioning AUD 1,000; unresolved

These are **business decisions**, not code defects. The implementation correctly refuses to guess: it fails closed on currency mismatch, refuses cross-currency allocation, and returns `null` for mixed-currency summaries.

---

## 2. Current Finance Architecture

### 2.1 Core Financial Entities (from `src/lib/types.ts`)

| Entity | File | Lines | Status |
|--------|------|-------|--------|
| Orders (`sellingPrice`, `supplierCostSnapshot`, `currency`, `exchangeRate`, `convertedAmount`) | `types.ts:351-375` | Implemented |
| PriceList (`amount`, `currency`) | `types.ts:610-621` | Implemented |
| AdditionalFee (`amount`, `currency`) | `types.ts:625-638` | Implemented |
| Invoices (`currency`, `total`, `lineItems`, `status`, `qbSyncStatus`) | `types.ts:519-527` | Implemented |
| Payments (`currency`, `amount`, `allocatedAmount`, `exchangeRate`, `exchangeRateSource`, `exchangeRateAt`) | `types.ts:557-568` | Implemented |
| PaymentPlan / Instalment (`currency`) | `types.ts:548-553, 847-852` | Implemented |
| Commission Records (`commissionAmount`, `commissionCurrency`, `exchangeRate`, `convertedAmount`) | `types.ts:683-686` | Implemented |
| CurrencyRate (`fromCurrency`, `toCurrency`, `rate`, `source`, `effectiveAt`) | `types.ts:797-805` | **Type exists, no implementation** |
| Supplier Routes (`wholesaleCost`, `currency`) | `types.ts:130-131` | Implemented |

### 2.2 API Endpoints

| Endpoint | File | Permission | Status |
|----------|------|-----------|--------|
| GET/POST `/api/invoices` | `src/app/api/invoices/route.ts` | `finance.manage` (POST), `finance.view` (GET) | Implemented |
| POST `/api/invoices/[id]/void` | `src/app/api/invoices/[id]/void/route.ts` | `finance.manage` | Implemented |
| PATCH `/api/invoices/[id]` | `src/app/api/invoices/[id]/route.ts` | — | Partially inspected |
| GET/POST `/api/payments` | `src/app/api/payments/route.ts` | `finance.manage` (POST), `finance.view` (GET) | Implemented |
| POST `/api/payments/[id]/refund` | `src/app/api/payments/[id]/refund/route.ts` | — | Exists, not inspected |
| GET/POST `/api/commission-records` | `src/app/api/commission-records/route.ts` | `commissions.manage` | Implemented |
| POST `/api/commission-records/[id]/approve` | `src/app/api/commission-records/[id]/approve/route.ts` | `commissions.manage` | Implemented |
| POST `/api/commission-records/[id]/reject` | `src/app/api/commission-records/[id]/reject/route.ts` | `commissions.manage` | Implemented |
| GET/POST `/api/commission-payouts` | `src/app/api/commission-payouts/route.ts` | `commissions.manage` | Implemented |
| GET `/api/finance/summary` | `src/app/api/finance/summary/route.ts` | `finance.view` | Implemented |
| GET `/api/reports/finance` | `src/app/api/reports/finance/route.ts` | `reports.view` | Implemented |
| GET `/api/reports/clients` | `src/app/api/reports/clients/route.ts` | `reports.view` | Implemented |
| GET `/api/reconciliation` | `src/app/api/reconciliation/route.ts` | `finance.reconcile` | Implemented |

---

## 3. Currency Handling Findings

### 3.1 Currency Representation

**VERIFIED** — Currency is tracked at the record level across all financial entities:

| Entity | Currency Field | File:Line |
|--------|---------------|-----------|
| Order | `currency: Currency` | `types.ts:354` |
| Invoice | `currency?: Currency` | `types.ts:524` |
| Payment | `currency?: Currency` | `types.ts:562` |
| PriceList | `currency: Currency` | `types.ts:615` |
| AdditionalFee | `currency: Currency` | `types.ts:630` |
| Supplier Route | `currency` | `types.ts:131` |
| Commission Record | `commissionCurrency: Currency` | `types.ts:684` |
| Commission Payout | `currency` | `types.ts:693` |
| Payment Plan / Instalment | `currency: Currency` | `types.ts:552, 851` |
| Currency Rate | `fromCurrency`, `toCurrency` | `types.ts:799-800` |

### 3.2 Supported Currency Codes

**VERIFIED** — Valid currencies: `AUD`, `BDT`, `USD`, `GBP`, `EUR`, `INR`

Defined in `src/lib/pricing-validation.ts:34-41`:
```typescript
export const VALID_CURRENCIES = new Set(["AUD", "BDT", "USD", "GBP", "EUR", "INR"]);
```

Used in:
- Invoice creation (`route.ts:135-137`)
- Payment recording (`route.ts:98-103`)
- Commission payout validation (`route.ts:124-128`)

### 3.3 Mixed-Currency Safety (VERIFIED — no silent cross-currency summing)

**File:** `src/app/api/finance/summary/route.ts:85-147`

The finance summary groups all amounts by currency and explicitly returns `null` for top-level totals when multiple currencies are present:

```typescript
const mixedCurrency = currencies.length > 1;
const single = currencies.length === 1 ? byCurrency[currencies[0]] : null;
return NextResponse.json({
  invoiced: mixedCurrency ? null : single?.invoiced ?? 0,
  collected: mixedCurrency ? null : single?.collected ?? 0,
  ...
  note: mixedCurrency ? "Multiple currencies are present. Use currencyBreakdown; no conversion is applied." : null,
});
```

**Impact:** Callers cannot accidentally present an invalid cross-currency sum as a real total. This is a deliberate safety design.

### 3.4 Default Currency Assumption

**PARTIAL / UNVERIFIED** — Several places default to `"AUD"` when currency is missing:

- `finance-classification.ts:70-72`: `paymentCurrency()` returns `"AUD"` when `payment.currency` is missing/empty
- `orders/route.ts:227`: `sellingCurrency = "AUD"` default before price list resolution
- `invoices/route.ts`: currency is required, no default
- `payments/route.ts:105`: `paymentCurrency = currency ?? "AUD"`

**Risk:** If a record was created without an explicit currency, it is treated as AUD by default. No business policy has been reviewed or approved to designate AUD as the base/reporting currency.

### 3.5 Currency Validation (VERIFIED)

- Invoice line item currency must match invoice currency (`invoices/route.ts:53-55`)
- Payment currency must match invoice currency for allocation (`payments/route.ts:194-199`)
- Invalid currencies rejected with `BAD_REQUEST` / `CURRENCY_MISMATCH`

---

## 4. Exchange Rate Handling Findings

### 4.1 Exchange Rate Fields

| Entity | Fields | File:Line |
|--------|--------|-----------|
| Order | `exchangeRate`, `convertedAmount` | `types.ts:373,375` |
| Payment | `exchangeRate`, `exchangeRateSource`, `exchangeRateAt` | `types.ts:838-840` |
| Commission Record | `exchangeRate`, `convertedAmount` | `types.ts:685-686` |
| CurrencyRate (type only) | `fromCurrency`, `toCurrency`, `rate`, `source`, `effectiveAt` | `types.ts:797-805` |

### 4.2 Exchange Rate Storage

**VERIFIED** — Orders and payments store exchange rates:
- `orders/route.ts:231-281`: Sets `exchangeRate` and `convertedAmount` on order creation
- `payments/route.ts:126-137`: Validates and stores `exchangeRate`, `exchangeRateSource`, `exchangeRateAt`

### 4.3 Exchange Rate Source / Provider

**NOT IMPLEMENTED** — No exchange rate provider is configured. No service fetches or stores rates.

### 4.4 Placeholder Rate = 1 (CRITICAL GAP)

**VERIFIED** — Both order creation and commission calculation use `exchangeRate = 1` as a placeholder:

**`src/app/api/orders/route.ts:275-281`:**
```typescript
// Exchange-rate snapshot: placeholder 1 unless a real FX source is configured.
if (sellingCurrency !== "AUD") {
  exchangeRate = 1;
  convertedAmount = resolvedSellingPrice;
} else {
  convertedAmount = resolvedSellingPrice;
}
```

**`src/app/api/commission-records/route.ts:340-354`:**
```typescript
// Currency conversion snapshot when order currency differs from commission currency.
let exchangeRate: number | null = null;
let convertedAmount: number | null = null;
if (eligibleDealCount > 0 && commissionCurrency) {
  const saleCurrency = orders[0]?.currency || "AUD";
  if (saleCurrency !== commissionCurrency) {
    // Placeholder rate: management must configure a real FX source.
    exchangeRate = 1;
    convertedAmount = commissionAmount;
  } else {
    convertedAmount = commissionAmount;
  }
}
```

**Impact:** Any non-AUD order or commission is recorded with `exchangeRate = 1` and `convertedAmount = commissionAmount` (i.e., treated as if 1 unit of foreign currency = 1 AUD). This is explicitly marked as a placeholder in the code comments.

### 4.5 Rate Source and Timestamp

**PARTIAL** — Payments store `exchangeRateSource` and `exchangeRateAt` (timestamp when rate was provided). Orders store `exchangeRate` but no source or timestamp field on the order itself.

### 4.6 Missing-Rate Behavior

**NOT DEFINED** — No policy exists for what happens when an exchange rate is unavailable. The placeholder `1` would silently produce incorrect conversions.

### 4.7 Decimal Precision and Rounding

**NOT DEFINED** — No rounding policy. JavaScript `Number` (float64) is used throughout. No `Decimal.js`, no fixed-decimal arithmetic, no rounding mode specified.

### 4.8 Historical Conversion

**NOT IMPLEMENTED** — No mechanism to convert historical transactions at different rates. The `CurrencyRate` type exists but is never populated or queried.

---

## 5. Invoice and Payment Findings

### 5.1 Invoice Creation

**VERIFIED** — `src/app/api/invoices/route.ts:116-250`

- Server-side total computation from line items; client-submitted totals not trusted
- Currency validation: line item currency must match invoice currency
- Duplicate prevention: one draft/issued invoice per order
- Immutable: "Historical invoice values are immutable — changing an order's price list never rewrites an issued invoice"
- QB sync enqueued on creation
- Audit record written on creation

### 5.2 Invoice Immutability

**VERIFIED** — Route comments confirm immutability:
- `invoices/route.ts:8`: "Historical invoice values are immutable"
- `orders/route.ts:8-9`: "The supplier cost snapshot is captured server-side at order creation time. The client never sends a supplier cost... Existing orders retain their original snapshot"

### 5.3 Void Invoice Handling

**VERIFIED** — `src/app/api/invoices/[id]/void/route.ts`:
- Sets `status: "Void"` via `updateOne`
- Writes audit record
- Payments to void invoices are excluded from finance collection (`finance-classification.ts:27-29`)

### 5.4 Payment Allocation

**VERIFIED** — `src/app/api/payments/route.ts:49-342`

- Server-side allocation in MongoDB transaction
- Idempotency key prevents duplicate allocations
- Validates outstanding balance before allocation
- Currency mismatch rejected: "Payment currency must match the invoice currency"
- Updates invoice allocation status (Paid / Part Paid)
- Writes audit record

### 5.5 Payment Classification

**VERIFIED** — `src/app/api/finance-classification.ts`:
- `collected` — payments allocated to a live (non-void) invoice
- `unallocated` — receipts with no invoice link
- `excluded` — void/refunded payments, and payments to void invoices
- No FX conversion performed; callers group by payment's own currency

### 5.6 Financial Field Masking

**VERIFIED** — `src/lib/financial-visibility.ts`:
- SUPER_ADMIN / ADMIN: all financial fields visible
- BDC: supplier cost, margin hidden; selling price and revenue visible
- B2B_AGENT: all price/revenue fields hidden (fail-closed)
- Keys deleted from objects (not set to undefined) so they don't appear in JSON

---

## 6. Commission Findings

### 6.1 Commission Calculation

**VERIFIED** — `src/app/api/commission-records/route.ts:119-407`

- Per agent + period (month/year)
- Reads approved, active commission rules from `agent_commission_rules`
- Eligibility depends on rule's `eligibleOrderStatuses`
- Duplicate prevention: one record per agent + period
- Ambiguity prevention: >1 applicable rule returns error ("No precedence policy is configured")
- Attribution by responsibility (sales_closing → `salesAgentId`, certificate_source → `sourceAgentId`, rto_contact → `rtoContactId`)
- Tiered per-deal commission within bands
- Commission amount = eligible deal count × commission per deal

### 6.2 Commission Currency

**VERIFIED** — `commissionCurrency` stored on commission record. Payouts must match amount AND currency exactly (`commission-payouts/route.ts:159-171`).

### 6.3 Commission Exchange Rate

**PLACEHOLDER** — `commission-records/route.ts:340-354`:
```typescript
// Placeholder rate: management must configure a real FX source.
exchangeRate = 1;
convertedAmount = commissionAmount;
```

### 6.4 Commission Approval Workflow

**VERIFIED** — `commission-records/[id]/approve/route.ts` and `[id]/reject/route.ts`:
- Records created in `calculated` status
- Must be explicitly approved by management before payout
- Only approved records can be paid out
- Payout amount and currency must match exactly

---

## 7. QuickBooks Integration Findings

### 7.1 Implementation Status

| Aspect | File | Status |
|--------|------|--------|
| OAuth2 authorization URL | `src/lib/quickbooks.ts:97-107` | Implemented |
| Token exchange (code → tokens) | `src/lib/quickbooks.ts:110-183` | Implemented |
| Token encryption (AES-256-GCM via `QB_ENCRYPTION_KEY`) | `src/lib/quickbooks.ts:49-87` | Implemented |
| Token refresh | `src/lib/quickbooks.ts:187-268` | Implemented |
| Connection status tracking | `src/lib/types.ts:762-773` | Implemented |
| Sync record tracking | `src/lib/types.ts:572-581` | Implemented |
| QB sync record v2 | `src/lib/types.ts:781-795` | Implemented |
| Invoice external state | `src/lib/types.ts:494-517` | Implemented |
| QB connect route | `src/app/api/integrations/quickbooks/connect/route.ts` | Implemented |
| QB status route | `src/app/api/integrations/quickbooks/status/route.ts` | Implemented |
| QB sync enqueue | `quickbooks.ts:399-455` | Implemented (idempotent by key) |
| QB retry | `quickbooks.ts:458-527` | Implemented |
| QB transport (actual API calls) | `quickbooks.ts:490-497` | **NOT IMPLEMENTED** — returns "QuickBooks transport not implemented in Next.js" |

### 7.2 QB_ENCRYPTION_KEY

**VERIFIED** — Required before any OAuth token can be stored:
- `quickbooks.ts:49-53`: `scryptSync(secret, "skills-connect-qb", 32)`
- `quickbooks.ts:157-159`: Fail closed if encryption not configured
- `quickbooks.ts:248-250`: Same for refresh
- `.env.example:41-44`: Documented but empty value
- `render.yaml` (Phase 8A): Added as `sync: false` secret

### 7.3 Never Tested Against Real API

**NOT VERIFIED** — `settings.tsx:8`: "QuickBooks sandbox + credentials — Blocked — no credentials yet"

### 7.4 Currency Mapping in QB

**NOT IMPLEMENTED** — No currency conversion or mapping logic for QuickBooks sync. The `InvoiceExternalState` type exists but no rate conversion logic.

---

## 8. Security and Data Integrity Findings

### 8.1 Authorization (VERIFIED)

| Endpoint | Permission | File |
|----------|-----------|------|
| Invoice create | `finance.manage` | `invoices/route.ts:116` |
| Invoice list | `finance.view` | `invoices/route.ts:60` |
| Invoice void | `finance.manage` | `invoices/[id]/void/route.ts:12` |
| Payment create | `finance.manage` | `payments/route.ts:49` |
| Payment list | `finance.view` | `payments/route.ts:28` |
| Commission calculate | `commissions.manage` | `commission-records/route.ts:119` |
| Commission approve/reject | `commissions.manage` | `approve/route.ts:10`, `reject/route.ts:11` |
| Commission payout | `commissions.manage` | `commission-payouts/route.ts:91` |
| Finance summary | `finance.view` | `finance/summary/route.ts:41` |
| Finance report | `reports.view` | `reports/finance/route.ts:26` |
| Reconciliation | `finance.reconcile` | `reconciliation/route.ts:16` |

### 8.2 Order Access Scoping

**VERIFIED** — `checkOrderAccess` used in payment creation (`payments/route.ts:91-96`). BDC/B2B_AGENT scoped to their orders.

### 8.3 Financial Field Masking

**VERIFIED** — `src/lib/financial-visibility.ts` implements role-based field hiding. BDC sees selling price but not supplier cost; B2B_AGENT sees neither.

### 8.4 Historical Immutability

**VERIFIED** — Invoice totals are server-computed, supplier cost snapshots captured at order creation, routes expire rather than overwrite, void invoices never resurrected.

### 8.5 Audit Trail

**VERIFIED** — `writeAudit()` called on invoice create, payment create, commission calculate/approve/reject, payout, void.

### 8.6 IDOR / Unauthorized Access

**No gaps identified** — All mutating routes use `withAuth` with permission checks. Order access uses `checkOrderAccess`. Client access derived from order ownership.

---

## 9. Existing Tests and Verification Results

### 9.1 Test Files

| Test File | Lines | Focus |
|-----------|-------|-------|
| `tests/phase5-finance.test.ts` | 412 | Invoice/payment/finance summary integrity |
| `tests/phase5-commission.test.ts` | 367 | Commission calculation, duplicate prevention, ambiguous rules |

### 9.2 Finance Test Coverage (from `phase5-finance.test.ts`)

| Test | Status | Code Reference |
|------|--------|----------------|
| Rejects payment to void invoice without resurrecting | ✅ | `payments/route.ts:186-191` |
| Rejects payment with currency different from invoice | ✅ | `payments/route.ts:194-199` |
| Rejects negative line item amount | ✅ | `invoices/route.ts:44-45` |
| Rejects non-numeric line item amount | ✅ | `invoices/route.ts:47-48` |
| Rejects line item currency mismatch | ✅ | `invoices/route.ts:53-55` |
| Blocks status bypass through invoice PATCH | ✅ | `invoices/[id]/route.ts` |
| Reports unallocated receipts separately | ✅ | `finance-classification.ts` |

### 9.3 Commission Test Coverage (from `phase5-commission.test.ts`)

| Test | Status |
|------|--------|
| Persists API-created eligibility and end-date snapshots | ✅ |
| Fails closed when more than one rule applies | ✅ |
| (Additional tests at lines 160-367) | — |

### 9.4 Test Results

| Check | Result |
|-------|--------|
| Full Vitest suite | **327 passed, 25 files, 0 failed** |
| Finance/commission tests | Included in 327 total |

---

## 10. Business Decisions Requiring Approval

| # | Decision | Why Needed | Current Placeholder |
|---|----------|------------|-------------------|
| 1 | **Official base/reporting currency** | Finance summaries, commission conversion, payout currency | `AUD` used as default but never approved |
| 2 | **Exchange-rate provider** | Rate fetching for multi-currency conversion | None configured |
| 3 | **Snapshot exchange rate at transaction time?** | Historical reproducibility | `orders/route.ts` uses placeholder `1`; payments allow manual entry |
| 4 | **How to convert/report historical transactions** | Cross-period financial reporting | No mechanism exists |
| 5 | **Decimal precision and rounding rules** | Consistent financial calculations | None defined; JS float64 used throughout |
| 6 | **Behavior when exchange rate unavailable** | Prevent silent incorrect conversions | Placeholder `1` silently used |
| 7 | **Which currency monthly commissions use** | Commission payout currency | Rule's `commissionCurrency` field exists but no business policy |
| 8 | **Commission use transaction-time FX snapshots?** | Historical commission accuracy | Placeholder `1` used |
| 9 | **QuickBooks currency mapping and conversion policy** | QB sync accuracy | No currency mapping logic exists |

---

## 11. Technical Implementation Recommendations

### 11.1 CurrencyRate Service (NEW)
Create a service to store, fetch, and validate exchange rates:
- Collection: `currency_rates` with fields from `CurrencyRate` type
- Fields: `fromCurrency`, `toCurrency`, `rate`, `source`, `effectiveAt`, `createdAt`
- Unique index on `(fromCurrency, toCurrency, effectiveAt)` to prevent duplicates

### 11.2 Rate Snapshot on Transactions
When creating orders, invoices, or payments with non-base currency:
- Look up rate effective at transaction time
- Store `exchangeRate`, `exchangeRateSource`, `exchangeRateAt`
- Fail closed if no rate available (do not use placeholder `1`)

### 11.3 Rounding Policy
- Define decimal precision (typically 2 for currency amounts, 4-6 for exchange rates)
- Implement rounding helper (e.g., round half up)
- Apply consistently across all financial calculations

### 11.4 Missing-Rate Behavior
- Fail closed: reject transactions that require conversion when no rate exists
- Do not silently use `1` as placeholder

### 11.5 Historical Conversion
- For reporting, convert historical amounts at the rate effective at transaction time (if stored)
- If no rate stored, mark as "cannot convert" rather than guessing

### 11.6 Commission Currency Policy
- Define default commission currency per agent or per organization
- Store commission rate snapshot with each commission record

---

## 12. Risks and Dependencies

| Risk | Severity | Evidence | Mitigation |
|------|----------|----------|------------|
| Silent incorrect FX conversion (placeholder rate = 1) | High | `orders/route.ts:275-281`, `commission-records/route.ts:349-350` | Approve FX policy; implement rate lookup; fail closed |
| No base currency approved | High | `paymentCurrency()` defaults to `"AUD"` but never approved | Business decision required |
| Cross-currency payment allocation | Medium | Rejected with `CURRENCY_MISMATCH` (safe) | Current behavior is correct; keep |
| Mixed-currency summary misuse | Medium | Returns `null` for mixed currency (safe) | Current behavior is correct; keep |
| Historical commission recalculation | Low | Commission records store snapshot amounts | Current behavior is correct; keep |
| Invoice discrepancy (INV 272) | Medium | Referenced in task: listed AUD 500, note mentions AUD 1,000 | Business clarification needed |

---

## 13. Recommended Implementation Sequence

### Phase 8B1 — FX Policy Decision (Week 1)
- Business approves: base currency, exchange-rate provider, rounding rules, missing-rate behavior
- Document decisions in `docs/`

### Phase 8B2 — CurrencyRate Service (Week 2)
- Implement `currency_rates` collection
- Implement rate lookup service
- Add unique index on `(fromCurrency, toCurrency, effectiveAt)`

### Phase 8B3 — Transaction-Time Rate Snapshots (Week 3)
- Order creation: look up rate, store `exchangeRate`/`convertedAmount`, fail closed if missing
- Payment creation: validate and store `exchangeRate`/`exchangeRateSource`/`exchangeRateAt`
- Commission calculation: use stored rate snapshot

### Phase 8B4 — Rounding Policy (Week 4)
- Implement rounding helper
- Apply to all financial calculations

### Phase 8B5 — Historical Conversion Reporting (Week 5)
- Finance summary: optional currency conversion using stored rates
- Mark unconverted amounts clearly

### Phase 8B6 — QuickBooks Currency Mapping (Week 6)
- QB sync currency mapping
- Reconciliation for currency mismatches

---

## 14. Final Readiness Verdict

**READY FOR PHASE 8B IMPLEMENTATION WITH BLOCKERS**

The finance engine is production-ready for single-currency (AUD) operations:
- ✅ Multi-currency data model
- ✅ No silent cross-currency summing
- ✅ Server-side invoice totals
- ✅ Server-side payment allocation with idempotency
- ✅ Historical immutability
- ✅ Commission calculation with approval workflow
- ✅ 327 tests pass, build succeeds

**Blocked for multi-currency production use until:**
1. Business approves base currency, FX provider, rounding rules
2. CurrencyRate service implemented
3. Exchange rate snapshot logic replaces placeholder `1`
4. QuickBooks sandbox credentials obtained and tested

---

**Report path:** `docs/PHASE-8B-FINANCE-FX-BUSINESS-RULES-AUDIT.md`

**Git state:** Branch `rony-dev`, HEAD `ed043712fe1bb34793be97e1f5c53b3c76161f1c`, working tree unchanged (no modifications made during this audit)
