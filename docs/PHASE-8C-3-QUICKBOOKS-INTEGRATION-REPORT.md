# Phase 8C-3 — QuickBooks Integration Report

**Repository:** Skills Connect Admin  
**Branch:** `rony-dev`  
**HEAD:** `0593e7ab10a1e0e810bd7a6d9a9223b94ac149a9`  
**Status:** Complete  
**Commit/Push/Deploy:** None performed

---

## 1. Executive Summary

Phase 8C-3 implements the missing QuickBooks Online Accounting API transport layer. Previously, `retrySync()` returned `"QuickBooks transport not implemented in Next.js."` — no actual Intuit API calls were made. The transport layer now makes real HTTP calls to the QuickBooks Online Accounting API for customer, invoice, and payment synchronization, with comprehensive error handling, retry logic, and currency validation.

**Important:** Live QuickBooks integration has NOT been verified against a real Intuit sandbox. No sandbox credentials are available in this environment. All transport code is tested with mocked `fetch()` calls. The transport is ready to use once `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REALM_ID`, and `QB_ENCRYPTION_KEY` are configured.

---

## 2. Files Changed

| File | Action | Reason |
|---|---|---|
| `src/lib/quickbooks-transport.ts` | Created | QuickBooks Online Accounting API transport layer |
| `src/lib/quickbooks.ts` | Modified | `retrySync()` now uses transport layer instead of stub; exports `encryptToken`/`decryptToken` |
| `tests/phase-8c-quickbooks-transport.test.ts` | Created | 16 unit tests for transport layer with mocked fetch |

Total: 3 files (1 created source, 1 modified source, 1 created test).

---

## 3. Transport Layer Implementation

### `src/lib/quickbooks-transport.ts`

New module implementing the QuickBooks Online Accounting API transport.

**Exported functions:**

| Function | Purpose |
|---|---|
| `qbTransportConfig(env?)` | Resolves transport config from env vars (`QB_REALM_ID`, `QB_SANDBOX`, `QB_REQUEST_TIMEOUT_MS`) |
| `qbTransportReady(env?)` | Boolean readiness check (client ID, secret, realm ID present) |
| `syncCustomer(config, input)` | Create/update a customer in QB (POST /customer) |
| `syncInvoice(config, input)` | Create/update an invoice in QB (POST /invoice) |
| `syncPayment(config, input)` | Create/update a payment in QB (POST /payment) |
| `qbQuery(config, query)` | Generic QB query for reconciliation (POST /query) |

**Error handling:**

| Scenario | Behavior |
|---|---|
| 401 Unauthorized | One token refresh + retry; if still failing, `QB_AUTH_FAILED` |
| 429 Rate Limited | Exponential backoff retry (up to 3 attempts) |
| 5xx Server Error | Exponential backoff retry (up to 3 attempts) |
| Network timeout | Retry with backoff (up to 3 attempts) |
| 400 Bad Request / invalid payload | Fail immediately, no retry |
| Missing QB config | `QB_NOT_CONFIGURED`, fail closed |
| Missing access token | `QB_NO_ACCESS_TOKEN`, fail closed |

**Retry strategy:**
- Maximum 3 attempts
- Exponential backoff: `2^(attempt+1) * 1000ms`, capped at 30 seconds
- 401 triggers immediate token refresh (not counted as a retry attempt)

**Token management:**
- Uses existing `getAccessToken()` from `quickbooks.ts` (refreshes 5 min before expiry)
- Token refresh uses `decryptToken`/`encryptToken` (now exported from quickbooks.ts)
- Tokens are never logged or returned to callers

### Currency rules (strictly enforced)

| Rule | Implementation |
|---|---|
| New transactions must be AUD | `assertAudCurrency()` checks `currency === "AUD"` on all sync operations |
| Non-AUD rejected | Returns `QB_CURRENCY_MISMATCH` with `statusCode: 400` |
| No currency conversion | No FX rates used; QB `CurrencyRef` always set to `AUD` |
| Historical records preserved | Transport only handles new sync operations; no modification of historical data |

### `src/lib/quickbooks.ts` modifications

- `retrySync()` now calls transport layer functions (`syncCustomer`, `syncInvoice`, `syncPayment`) instead of returning the stub error `"QuickBooks transport not implemented in Next.js."`
- `encryptToken` and `decryptToken` are now exported for use by the transport layer's token refresh logic
- `enqueueSync()` already enqueues a `qb_sync` job (from Phase 8C-2) — the cron processor can now drive actual transport calls

---

## 4. Tests Added

New file: `tests/phase-8c-quickbooks-transport.test.ts` (16 tests)

| Test group | Test | Status |
|---|---|---|
| qbTransportConfig | Returns null without QB_REALM_ID | PASS |
| | Returns config with realm ID | PASS |
| | Respects QB_SANDBOX=false | PASS |
| | Respects QB_REQUEST_TIMEOUT_MS | PASS |
| qbTransportReady | False without credentials | PASS |
| | True with all credentials | PASS |
| syncCustomer | QB_NOT_CONFIGURED without QB config | PASS |
| | QB_CURRENCY_MISMATCH for non-AUD | PASS |
| | Syncs customer successfully | PASS |
| | Handles 401 auth failure | PASS |
| syncInvoice | QB_CURRENCY_MISMATCH for non-AUD | PASS |
| | Syncs invoice successfully | PASS |
| syncPayment | QB_CURRENCY_MISMATCH for non-AUD | PASS |
| | Syncs payment successfully | PASS |
| qbQuery | QB_NOT_CONFIGURED without QB config | PASS |
| | Queries successfully | PASS |

All tests use mocked `fetch()` — no real Intuit API calls are made.

---

## 5. Automated Verification Results

| Command | Result | Details |
|---|---|---|
| `npm test` | PASS | 29 test files, 377 tests passed, 0 failed (was 361 before QB transport) |
| `npm run typecheck` | PASS | `next typegen && tsc --noEmit` — clean |
| `npm run lint` | PASS | Exit 0; pre-existing warnings only |
| `npm run build` | PASS | Exit 0; production build succeeded |

Test count change: +16 tests (QB transport unit tests). Baseline: 361 → 377.

---

## 6. Remaining Blockers

| Blocker | Severity | Classification |
|---|---|---|
| Live QuickBooks sandbox verification | High | No sandbox credentials available; transport not tested against real Intuit API |
| QB_ENCRYPTION_KEY required | Medium | Token storage fails closed without `QB_ENCRYPTION_KEY`; must be set in deployment |
| QB_CLIENT_ID / QB_CLIENT_SECRET required | Medium | OAuth flow unavailable without client credentials |
| QB_REALM_ID required | Medium | Transport config requires realm ID; sync disabled without it |

**Live integration status: NOT VERIFIED.** The transport layer is implemented and tested with mocks, but no real Intuit API calls have been made. Do not claim live integration is working without sandbox verification.

---

## 7. Git Status

- Branch: `rony-dev`
- HEAD: `0593e7ab10a1e0e810bd7a6d9a9223b94ac149a9` (unchanged)
- Working tree: 3 modified/new files — all uncommitted
- No commit, push, or deployment performed

---

**Phase 8C-3 complete. Ready to proceed to Phase 8C-4 (Full system UAT & regression).**
