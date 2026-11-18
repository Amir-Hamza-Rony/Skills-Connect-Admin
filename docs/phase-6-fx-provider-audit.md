# Phase 6 — FX Provider Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Status:** Complete  

---

## 1. Executive Summary

This document audits the current multi-currency / exchange-rate implementation. It determines where exchange rates are obtained, confirms that a placeholder rate of 1 is used, identifies all calculations dependent on exchange rates, confirms snapshot immutability of historical records, and evaluates behavior when an FX provider is unavailable.

**Key finding:** No real FX provider is configured. A placeholder exchange rate of `1` is hardcoded wherever currency conversion is needed. No FX provider environment variables exist. Management must approve and configure a real FX source before multi-currency financial calculations reflect real market rates.

No paid FX provider was selected or integrated.

---

## 2. Where Exchange Rates Are Currently Obtained

### 2.1 Placeholder rate = 1 (hardcoded)

**File:** `src/app/api/orders/route.ts:218-224`

```ts
// Exchange-rate snapshot: placeholder 1 unless a real FX source is configured.
if (sellingCurrency !== "AUD") {
  exchangeRate = 1;
  convertedAmount = resolvedSellingPrice;
} else {
  convertedAmount = resolvedSellingPrice;
}
```

**File:** `src/app/api/commission-records/route.ts:271-277`

```ts
// Placeholder rate: management must configure a real FX source.
exchangeRate = 1;
convertedAmount = commissionAmount;
```

### 2.2 Client-supplied exchange rate (payments)

**File:** `src/app/api/payments/route.ts:109-120`

Payments accept an optional `exchangeRate` field from the request body. If provided, it is validated as a positive number and stored as a snapshot with `exchangeRateAt` timestamp. If not provided, `exchangeRate` is `null`.

**File:** `src/app/api/payments/route.ts:204-206`

```ts
exchangeRate: exchangeRateNum,
exchangeRateSource: exchangeRateSource ?? null,
exchangeRateAt: exchangeRateAt,
```

### 2.3 No FX provider environment variables

No environment variables exist for an FX provider (no `FX_API_KEY`, `FX_PROVIDER`, `FX_BASE_URL`, etc.). There is no scheduled job or background process that fetches live rates.

---

## 3. Calculations Dependent on Exchange Rates

| Location | Field | Currency direction | Rate source |
|----------|-------|-------------------|-------------|
| Order creation (`orders/route.ts`) | `exchangeRate`, `convertedAmount` | selling currency → AUD (reporting) | Placeholder `1` |
| Commission calculation (`commission-records/route.ts`) | `exchangeRate`, `convertedAmount` | sale currency → commission currency | Placeholder `1` |
| Payment creation (`payments/route.ts`) | `exchangeRate`, `exchangeRateSource`, `exchangeRateAt` | payment currency → reporting | Client-supplied (optional) |
| Finance summary (`finance/summary/route.ts`) | per-currency breakdown | None — grouped by currency, never cross-currency summed | N/A |
| Reports (`/api/reports/*`) | per-currency grouping | None — grouped by currency | N/A |
| Invoice creation | currency stored per invoice | No conversion at invoice time | N/A |

---

## 4. Immutability of Historical Financial Records

**Confirmed:** Historical order and financial snapshots remain immutable.

| Record | Snapshot fields | Mutated after creation? |
|--------|----------------|------------------------|
| Order | `exchangeRate`, `convertedAmount`, `sellingCurrency`, `feeTotal`, `additionalFees` | No — captured at creation, never rewritten |
| Commission record | `exchangeRate`, `convertedAmount`, `commissionCurrency` | No — captured at calculation |
| Payment | `exchangeRate`, `exchangeRateSource`, `exchangeRateAt` | No — captured at allocation |
| Invoice | `currency`, `total` | No conversion performed |

No code path recalculates historical transactions using today's exchange rate. The finance summary and reports only group by stored currency and use stored exchange-rate snapshots for optional reporting-currency conversion.

---

## 5. Behavior When FX Provider Is Unavailable

### Current state (no provider)
- Orders in non-AUD currency use exchange rate `1`, meaning `convertedAmount === resolvedSellingPrice`. This silently treats foreign currency amounts as if they were equal in value to AUD — **this is incorrect for any non-AUD currency**.
- Commission calculations in non-commission currencies use rate `1`.
- Payments allow `exchangeRate` to be omitted (`null`) — conversion is simply not recorded.

### Risk
Placeholder rate `1` is indistinguishable from a real rate of `1` in stored data. There is no flag or marker indicating that a rate is a placeholder versus a real market rate. This creates a silent data integrity risk for multi-currency financial reporting.

---

## 6. Recommendation: Prevent Placeholder Rates from Being Treated as Real

### Proposed approach (documented, not implemented)

1. **Add an `exchangeRateIsPlaceholder` boolean** (or `exchangeRateSource` enum) to Order, CommissionRecord, and Payment schemas, defaulting to `true` when rate `1` is used as a placeholder.
2. **Reject cross-currency calculations** that would use a placeholder rate in financial reports — either skip conversion or surface a warning that the rate is not real.
3. **Configure a real FX source** via environment variables (`FX_PROVIDER`, `FX_API_KEY`, `FX_BASE_URL`) and a service that fetches/stores rates, then replace the hardcoded `1` with the fetched rate.
4. **Document that historical records with rate `1` and no source are placeholders** and should not be used for financial restatement.

None of these changes are implemented in this phase. They require management approval.

---

## 7. Safe Operation Without an FX Provider

The application **can** safely operate without an FX provider under these conditions:

- All orders use AUD (the default/reporting currency) → rate `1` is correct.
- Multi-currency orders are not created, or stakeholders accept that non-AUD amounts are stored at rate `1` (placeholder).
- Financial reports are interpreted per-currency only (no cross-currency summation) — already the current behavior.

The application **cannot** safely produce accurate multi-currency financial reports without a real FX source.

---

## 8. Proposed Provider Integration Approach (for approval)

A future FX integration should:

1. Read `FX_PROVIDER`, `FX_API_KEY`, `FX_BASE_URL` from environment.
2. Fetch latest rates on demand or via a scheduled job (serverless cron / Vercel Cron).
3. Store rates in an `fx_rates` collection with `base`, `target`, `rate`, `fetchedAt`.
4. Replace hardcoded `1` in `orders/route.ts` and `commission-records/route.ts` with a lookup from `fx_rates`, falling back to the order's stored snapshot if no live rate is available.
5. Mark placeholder rates explicitly so they are not confused with real rates.

**Do not select or integrate a paid FX provider without approval.** Candidates for management consideration: ECB (free), Intuit QB FX (if QB is used), Open Exchange Rates, Frankfurter.app.

---

## 9. Summary of Statuses

| Area | Status |
|------|--------|
| Exchange rate source | NOT CONFIGURED (placeholder `1` hardcoded) |
| FX provider env vars | NONE EXIST |
| Order currency conversion | Placeholder rate `1` |
| Commission currency conversion | Placeholder rate `1` |
| Payment currency conversion | Client-supplied (optional, nullable) |
| Historical snapshot immutability | VERIFIED |
| Per-currency report grouping (no cross-currency sum) | VERIFIED |
| Placerate vs real rate distinguishable | NO — silent data risk |
| Safe operation without FX provider | Yes, if all-AUD or placeholder accepted |
| Real FX provider integration | REQUIRES APPROVAL (not implemented) |

---

## 10. Evidence Files

- `src/app/api/orders/route.ts:218-224` — Placeholder rate `1` on order creation
- `src/app/api/commission-records/route.ts:271-277` — Placeholder rate `1` on commission
- `src/app/api/payments/route.ts:109-120,204-206` — Client-supplied exchange rate
- `src/app/api/finance/summary/route.ts` — Per-currency grouping, no conversion
- `src/lib/types.ts:315,588,741-743` — `exchangeRate`, `exchangeRateSource`, `exchangeRateAt` types
- `docs/phase-5-implementation-report.md` — Phase 5 multi-currency notes (decision #1: exchange-rate source)
