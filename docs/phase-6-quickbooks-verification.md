# Phase 6 — QuickBooks Sandbox Verification

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Status:** Complete  

---

## 1. Executive Summary

This document audits the existing QuickBooks (QB) two-way integration implementation and determines which features can be verified locally without external credentials versus those requiring QuickBooks Sandbox credentials.

**Key finding:** The QB integration code structure is complete, but **no QuickBooks feature has been verified against a live Intuit sandbox**. No `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, or `QB_WEBHOOK_SECRET` are configured. External verification is **BLOCKED** pending credentials.

No credentials were invented, and no simulated successful QB connection was claimed.

---

## 2. Implementation Inventory

### 2.1 Routes

| Route | Method | Permission | Purpose | Status |
|-------|--------|------------|---------|--------|
| `/api/integrations/quickbooks/connect` | GET | `settings.manage` | Generate OAuth consent URL | Implemented |
| `/api/integrations/quickbooks/callback` | GET | `settings.manage` | OAuth callback, exchange code for tokens | Implemented |
| `/api/integrations/quickbooks/disconnect` | POST | `settings.manage` | Mark connection as disconnected | Implemented |
| `/api/integrations/quickbooks/status` | GET | `finance.view` | Connection health | Implemented |
| `/api/integrations/quickbooks/sync` | GET | `finance.view` | List sync records | Implemented |
| `/api/integrations/quickbooks/sync/[type]/[id]` | GET | `finance.view` | Get one sync record | Implemented |
| `/api/integrations/quickbooks/sync/[type]/[id]` | POST | `qb.retry` | Retry a failed sync | Implemented |
| `/api/integrations/quickbooks/webhook` | POST | None (signature) | QB webhook endpoint | Implemented |

### 2.2 Library facade (`src/lib/quickbooks.ts`)

| Function | Purpose | Status |
|----------|---------|--------|
| `isQuickBooksConfigured()` | Check for QB_CLIENT_ID + QB_CLIENT_SECRET | Implemented |
| `authorizationUrl(state)` | Build Intuit OAuth consent URL | Implemented |
| `exchangeCodeForTokens(code, realmId)` | Exchange auth code for access+refresh tokens | Implemented |
| `refreshAccessToken()` | Refresh expired access token | Implemented |
| `getAccessToken()` | Get valid token, refreshing 5 min before expiry | Implemented |
| `disconnect()` | Mark connection disconnected | Implemented |
| `quickBooksStatus()` | Return non-secret connection status | Implemented |
| `listSyncRecords()` | List all sync records | Implemented |
| `syncRecordFor(entityType, entityId)` | Get one sync record | Implemented |
| `enqueueSync({...})` | Enqueue local→QB sync (idempotent) | Implemented |
| `retrySync(entityType, entityId, actor)` | Retry a sync record | Implemented |

### 2.3 Collections

| Collection | Purpose | Indexes |
|------------|---------|---------|
| `qb_connections` | QB OAuth connection + encrypted tokens | None |
| `qb_sync_records` | Sync queue with idempotency | `idempotencyKey` (unique), `qbReference` |
| `qb_webhook_events` | Webhook event deduplication | `eventId` (unique) |
| `qb_reconciliation` | Reconciliation records | `itemId` (unique) |

---

## 3. Feature-by-Feature Verification Status

| Feature | Verifiable locally? | Verification method | Status | Evidence |
|---------|-------------------|---------------------|--------|----------|
| OAuth authorization URL generation | Yes | Code inspection — builds URL from env vars | VERIFIED (code complete) | `authorizationUrl()` in `quickbooks.ts:97` |
| OAuth state validation | Yes | Code inspection — `state === auth.userId` | VERIFIED (code complete) | `callback/route.ts:23` |
| OAuth token exchange (code → tokens) | No | Requires `QB_CLIENT_ID`/`QB_CLIENT_SECRET` + live Intuit endpoint | BLOCKED | `exchangeCodeForTokens()` calls `fetch(QB_TOKEN_URL)` |
| Token refresh | No | Requires valid refresh token + live Intuit endpoint | BLOCKED | `refreshAccessToken()` in `quickbooks.ts:185` |
| AES-256-GCM token encryption | Yes (logic only) | Code inspection — `createCipheriv("aes-256-gcm", ...)` | VERIFIED (code complete) | `encryptToken()`/`decryptToken()` |
| Encrypted token storage round-trip | No | Requires `QB_ENCRYPTION_KEY` + stored tokens | BLOCKED | `encryptToken`/`decryptToken` degrade to raw if key missing |
| Token storage in `qb_connections` | Yes (schema) | Code inspection — upsert with encrypted fields | VERIFIED (code complete) | `exchangeCodeForTokens()` upserts |
| Token never returned to frontend | Yes | Code inspection — status route returns only non-secret fields | VERIFIED (code complete) | `quickBooksStatus()` excludes tokens |
| Two-way sync (customer/invoice/payment) | No | `retrySync()` returns "transport not implemented" | BLOCKED | `retrySync()` in `quickbooks.ts:454` |
| Sync idempotency (idempotencyKey) | Yes | Code inspection — `enqueueSync` checks existing key | VERIFIED (code complete) | `enqueueSync()` in `quickbooks.ts:395` |
| Sync retry with attempt tracking | Yes | Code inspection — `attempts` incremented on retry | VERIFIED (code complete) | `retrySync()` increments `attempts` |
| Webhook HMAC-SHA256 signature validation | Yes (logic only) | Code inspection — `createHmac("sha256", secret)` | VERIFIED (code complete) | `webhook/route.ts:69` |
| Webhook signature with real secret | No | Requires `QB_WEBHOOK_SECRET` + live Intuit webhook | BLOCKED | `webhook/route.ts:59` |
| Webhook event deduplication | Yes | Code inspection — `qb_webhook_events` upsert | VERIFIED (code complete) | `markEventProcessed()` |
| Webhook always returns 200 to Intuit | Yes | Code inspection — catch blocks return 200 | VERIFIED (code complete) | `webhook/route.ts:127` |
| Reconciliation / conflict management | Yes (schema) | Collection + type defined | VERIFIED (code complete) | `qb_reconciliation` collection, `QBReconciliationRecord` type |
| Error handling | Yes | Code inspection — try/catch with graceful degradation | VERIFIED (code complete) | All QB functions catch and return errors |
| Audit logging on QB mutations | Partial | QB sync write not directly audited; `disconnect()` not audited | PARTIAL | `writeAudit()` not called in QB routes |

---

## 4. What Can Be Verified Without Credentials

The following can be verified through code inspection and unit-level logic review (no external credentials, no network to Intuit):

1. **OAuth URL construction** — correct query parameters, state binding, redirect URI.
2. **OAuth state validation** — callback rejects mismatched state with 403.
3. **Missing-credential degradation** — all QB functions return appropriate errors when `QB_CLIENT_ID`/`QB_CLIENT_SECRET` are absent.
4. **AES-256-GCM encryption/decryption logic** — correct cipher mode, IV, auth tag handling.
5. **Encryption key derivation** — scrypt with fixed salt, returns null if `QB_ENCRYPTION_KEY` missing.
6. **Token never exposed to frontend** — `quickBooksStatus()` returns only `configured`, `authorised`, `connectionStatus`, `realmId`, `sandbox`.
7. **Sync idempotency** — `enqueueSync()` returns existing record when `idempotencyKey` matches.
8. **Webhook signature validation** — HMAC-SHA256 comparison, returns 401 on missing/invalid signature.
9. **Webhook always answers 200** — catch-all error handling returns 200 to Intuit.
10. **Webhook event deduplication** — `qb_webhook_events` upsert prevents double processing.

---

## 5. What Requires QuickBooks Sandbox Credentials (BLOCKED)

The following **cannot** be verified without live Intuit sandbox credentials (`QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET`, and a QB sandbox company):

1. **OAuth token exchange** — `exchangeCodeForTokens()` POSTs to Intuit token endpoint; no sandbox = no tokens.
2. **Token refresh** — `refreshAccessToken()` POSTs to Intuit token endpoint.
3. **Encrypted token storage round-trip** — requires `QB_ENCRYPTION_KEY` and actual tokens to encrypt/decrypt.
4. **Two-way sync transport** — `retrySync()` returns `"QuickBooks transport not implemented in Next.js."` No QB API calls (customer/invoice/payment create/update) exist.
5. **Webhook signature with real secret** — no `QB_WEBHOOK_SECRET` configured, no live webhook events.
6. **End-to-end OAuth flow** — connect → consent → callback → token exchange → connected status.

---

## 6. Dedicated Background Worker Assessment

**Question:** Is a dedicated background worker or external queue necessary for reliable synchronization?

**Finding:** Yes — for production sync volume, but **no architecture change is introduced in this phase.**

### Rationale

- `retrySync()` is triggered via `POST /api/integrations/quickbooks/sync/[type]/[id]` — a synchronous HTTP request handler.
- Next.js route handlers (serverless/Vercel) have invocation time limits and are unsuitable for long-running or retried sync work with backoff.
- The sync queue (`qb_sync_records`) stores pending/failed records but no processor exists to drain the queue automatically.
- Webhook processing (`qb_webhook_events`) enqueues sync records but nothing processes them without manual retry via the API.

### Recommendation (documented, not implemented)

Deploy a dedicated background worker for:
- Draining `qb_sync_records` (Pending/Failed records) with retry + backoff.
- Processing webhook-enqueued sync records.
- Scheduled token refresh before expiry.

Options:
- Vercel Cron + serverless function (same deployment, scheduled).
- Separate worker service (external to Next.js).

**No worker is introduced in this phase** per the implementation policy (no new architecture without justification and approval).

---

## 7. Error Handling & Audit Logging Assessment

### Error handling strengths
- All QB functions wrap logic in try/catch and return `{ ok: false, error }` rather than throwing.
- Webhook always returns 200 to Intuit even if payload processing fails (per Intuit requirements).
- OAuth callback validates state before token exchange (403 on mismatch).
- Token exchange validates presence of `access_token` and `refresh_token` in response.
- Refresh failure marks connection as `"expired"`.

### Audit logging gaps
- QB routes do **not** call `writeAudit()` for connect, disconnect, sync retry, or webhook processing.
- Token exchange success/failure is not written to `audit_logs`.
- `disconnect()` in `quickbooks.ts` does not audit.

### Recommendation
Add `writeAudit()` calls to QB mutation routes (connect, disconnect, sync retry) for audit trail completeness.

---

## 8. Manual Sandbox Verification Checklist

**This checklist is for manual execution when QB sandbox credentials are available. It has NOT been executed.**

| Step | Action | Expected result | Credentials needed? | Verified? |
|------|--------|-----------------|---------------------|-----------|
| 1 | Set `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI`, `QB_ENCRYPTION_KEY`, `QB_SANDBOX=false` | App starts without QB errors | Yes | No |
| 2 | GET `/api/integrations/quickbooks/connect` | Returns OAuth URL with `client_id`, `scope`, `redirect_uri`, `state` | No | No |
| 3 | Visit OAuth URL in sandbox, authorize, return to callback | Callback exchanges code, returns `connected: true` | Yes | No |
| 4 | GET `/api/integrations/quickbooks/status` | Returns `configured: true`, `authorised: true`, `connectionStatus: "connected"` | Yes | No |
| 5 | Encrypt/decrypt token round-trip | `decryptToken(encryptToken("test"))` === `"test"` | Yes (key only) | No |
| 6 | POST `/api/integrations/quickbooks/sync/[type]/[id]` retry | Returns sync record with `status` and `attempts` | Yes (token) | No |
| 7 | POST `/api/integrations/quickbooks/disconnect` | Returns `connected: false` | Yes | No |
| 8 | POST webhook with valid `intuit-signature` HMAC | Returns 200, `ok: true` | Yes (`QB_WEBHOOK_SECRET`) | No |
| 9 | POST webhook with invalid signature | Returns 401 `INVALID_SIGNATURE` | Yes (`QB_WEBHOOK_SECRET`) | No |
| 10 | OAuth callback with mismatched `state` | Returns 403 `STATE_MISMATCH` | No | No |

---

## 9. Summary of Statuses

| Area | Status |
|------|--------|
| OAuth URL generation (code logic) | VERIFIED |
| OAuth state validation (code logic) | VERIFIED |
| AES-256-GCM encryption logic | VERIFIED |
| Token never exposed to frontend | VERIFIED |
| Sync idempotency | VERIFIED |
| Webhook signature validation logic | VERIFIED |
| Webhook always returns 200 | VERIFIED |
| Webhook event deduplication | VERIFIED |
| OAuth token exchange against Intuit | BLOCKED (no credentials) |
| Token refresh against Intuit | BLOCKED (no credentials) |
| Encrypted token storage round-trip | BLOCKED (no credentials) |
| Two-way sync transport | BLOCKED (not implemented + no credentials) |
| Webhook signature with real secret | BLOCKED (no credentials) |
| End-to-end QB connection | BLOCKED (no credentials) |
| Dedicated background worker | NOT IMPLEMENTED (recommended) |
| QB audit logging on mutations | PARTIAL (missing) |

---

## 10. Evidence Files

- `src/lib/quickbooks.ts` — QB facade, encryption, sync queue
- `src/app/api/integrations/quickbooks/connect/route.ts` — OAuth URL
- `src/app/api/integrations/quickbooks/callback/route.ts` — OAuth callback + state validation
- `src/app/api/integrations/quickbooks/disconnect/route.ts` — Disconnect
- `src/app/api/integrations/quickbooks/status/route.ts` — Connection status
- `src/app/api/integrations/quickbooks/sync/route.ts` — List sync records
- `src/app/api/integrations/quickbooks/sync/[type]/[id]/route.ts` — Get/retry sync
- `src/app/api/integrations/quickbooks/webhook/route.ts` — Webhook + HMAC + dedup
- `docs/phase-4-finance-audit.md` — Phase 4 finance/QB audit (baseline)
- `docs/FINAL_PRODUCTION_READINESS_AUDIT.md` — Final readiness audit (baseline)
