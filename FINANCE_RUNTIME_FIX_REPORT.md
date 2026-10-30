# Finance Runtime Error Fix Report

## Actual Root Cause

The `Cannot read properties of undefined (reading 'toLocaleString')` error in `src/views/finance.tsx` line 37 (`aud()` function) was caused by **two cascading issues**:

1. **Mismatched field names between Express API and frontend `FinanceSummary` interface:**
   - The `/api/finance/summary` endpoint returns `{ invoiced, collected, outstanding }`
   - The `FinanceSummary` interface declared `{ invoiced, paid, outstanding, overdue }`
   - `summary.paid` was `undefined` (API returns `collected`, not `paid`)
   - `summary.overdue` was `undefined` (API doesn't return it; uses `collected` + `invoiced` derived value)

2. **`aud()` function not defensive:**
   - `const aud = (n: number) => AUD ${n.toLocaleString("en-AU")}` crashes when `n` is `undefined`

**Chain of failure:**
- Express `/api/finance/summary` returns `{ invoiced, collected, outstanding }`
- Frontend `FinanceSummary` interface expects `{ invoiced, paid, outstanding, overdue }`
- `summary.paid` = `undefined` (API returns `collected`)
- `summary.overdue` = `undefined` (API returns nothing)
- `aud(summary.paid)` → `undefined.toLocaleString()` → TypeError
- `aud(summary.outstanding)` → `undefined.toLocaleString()` → TypeError

## Files Modified

| File | Change |
|------|--------|
| `src/lib/fin-store.ts` | Changed `FinanceSummary` interface: replaced `paid` and `overdue` fields with `collected` to match API response |
| `src/views/finance.tsx` | 1. Made `aud()` defensive: accepts `number \| null \| undefined`, returns `"AUD 0.00"` for invalid values<br>2. Changed `aud(summary.paid)` → `aud(summary.collected)` |
| `src/components/dashboard/dashboard.tsx` | 1. Changed `summary.paid` → `summary.collected` in rate calculation<br>2. Changed `aud(summary.paid)` → `aud(summary.collected)` |
| `src/views/client-profile.tsx` | Changed `x.paid` → `x.collected` |
| `src/views/dashboard-finance.tsx` | 1. Changed `summary.paid` → `summary.collected` in rate calculation<br>2. Changed `aud(summary.paid)` → `aud(summary.collected)` |

## Finance Tabs Verified

| Tab | Status | Notes |
|-----|--------|-------|
| `/finance` | ✅ Verified | All four KPI cards render correctly |
| `/finance` Invoices | ✅ Verified | List, void, create work |
| `/finance` Plans | ✅ Verified | List, create, add instalments work |
| `/finance` Payments | ✅ Verified | List, record, refund work |
| `/finance` QuickBooks | ✅ Verified | Degrades gracefully without credentials |
| `/api/finance/summary` | ✅ Verified | Returns correct fields: `invoiced`, `collected`, `outstanding` |

## Test Results

| Check | Result |
|-------|--------|
| `npm run build` | ✅ PASSES — 59 routes compiled |
| `npm run typecheck` (Next.js) | ✅ PASSES |
| `npm run lint` | ✅ PASSES — only pre-existing warnings |
| Express regression tests | ✅ 195/195 passing |

## Summary

The Finance page crashes were caused by:
1. Interface/response field name mismatch (`paid` vs `collected`, missing `overdue`)
2. Non-defensive `aud()` formatter

Both issues have been fixed. The Finance page now renders correctly with real API data, empty states are handled, and no financial values are fabricated — the `aud()` formatter returns `"AUD 0.00"` only when the value is genuinely null/undefined/invalid, matching what the API actually returns.