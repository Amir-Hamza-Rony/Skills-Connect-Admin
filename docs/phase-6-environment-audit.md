# Phase 6 — Production Environment Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Status:** Complete  

---

## 1. Executive Summary

This document audits all environment variable references across the Skills Connect Admin codebase. It identifies required vs. optional variables, the modules that depend on each, whether each is validated at startup, and the failure mode when missing. It also provides a safe Vercel deployment checklist.

**No actual secret values are displayed anywhere in this document.** No `.env` file is created or committed.

---

## 2. Environment Variable Reference Inventory

All `process.env.*` references found in `src/`:

| Variable | File | Line | Purpose | Required? | Validated at startup? | Missing → safe failure? |
|----------|------|------|---------|-----------|----------------------|------------------------|
| `MONGODB_URI` | `src/lib/db.ts` | 13 | MongoDB connection string | Yes | No (lazy on first `getDb()`) | No — runtime failure on DB access |
| `MONGODB_URI` | `src/lib/mongodb.ts` | 10 | MongoDB connection string | Yes | Yes — throws if missing | No — module load throws |
| `MONGODB_DB` | `src/lib/db.ts` | 21 | Database name | No | No | Defaults to `skills_connect_admin` |
| `MONGODB_DB` | `src/lib/mongodb.ts` | 11 | Database name | No | No | Defaults to `skills_connect_admin` |
| `JWT_ACCESS_SECRET` | `src/lib/api-auth.ts` | 13 | JWT access token signing secret | Yes | Yes — throws if missing | No — module load throws |
| `JWT_REFRESH_SECRET` | `src/lib/api-auth.ts` | 14 | JWT refresh token signing secret | Yes | Yes — throws if missing | No — module load throws |
| `ACCESS_TOKEN_TTL_MIN` | `src/lib/api-auth.ts` | 15 | Access token TTL in minutes | No | No | Defaults to `15` |
| `REFRESH_TOKEN_TTL_DAYS` | `src/lib/api-auth.ts` | 16 | Refresh token TTL in days | No | No | Defaults to `7` |
| `NODE_ENV` | `src/lib/api-auth.ts` | 133, 145 | Cookie `secure` flag | No | No | Defaults falsy → cookies not secure |
| `NEXT_PUBLIC_API_BASE_URL` | `src/lib/api.ts` | 22 | External API base URL | No | No | Defaults to `""` (same origin) |
| `QB_ENCRYPTION_KEY` | `src/lib/quickbooks.ts` | 50 | AES-256-GCM key derivation input | No (for QB) | No | Token encryption degraded to raw storage |
| `QB_CLIENT_ID` | `src/lib/quickbooks.ts` | 92, 99, 121 | QB OAuth client ID | No (for QB) | No | `isQuickBooksConfigured()` returns `false` |
| `QB_CLIENT_SECRET` | `src/lib/quickbooks.ts` | 92, 121 | QB OAuth client secret | No (for QB) | No | `isQuickBooksConfigured()` returns `false` |
| `QB_REDIRECT_URI` | `src/lib/quickbooks.ts` | 103, 128 | QB OAuth redirect URI | No (for QB) | No | Defaults to `http://localhost:4000/...` |
| `QB_AUTH_URL` | `src/lib/quickbooks.ts` | 106 | QB OAuth authorization endpoint | No | No | Defaults to Intuit production URL |
| `QB_TOKEN_URL` | `src/lib/quickbooks.ts` | 119, 206 | QB OAuth token endpoint | No | No | Defaults to Intuit production URL |
| `QB_REALM_ID` | `src/lib/quickbooks.ts` | 338 | QB realm ID override | No | No | Falls back to DB-stored realmId |
| `QB_SANDBOX` | `src/lib/quickbooks.ts` | 339 | Sandbox mode flag | No | No | Defaults to `true` (sandbox) unless `"false"` |
| `QB_WEBHOOK_SECRET` | `src/app/api/integrations/quickbooks/webhook/route.ts` | 59 | QB webhook HMAC secret | No (for webhooks) | No | Webhook returns 401 if missing |

### Observations

- **Two MongoDB connection helpers exist:** `src/lib/db.ts` (used by most routes) and `src/lib/mongodb.ts` (used by some). Both read `MONGODB_URI`. `mongodb.ts` throws at module load if missing; `db.ts` fails lazily on first DB access.
- **JWT secrets are validated eagerly:** `api-auth.ts` throws immediately if `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` are missing, which prevents the module from loading. This is a safe-fail design.
- **QuickBooks variables are gracefully degraded:** All QB functions return `null`/`false`/error responses when credentials are absent. No crash.
- **No startup validation exists for `MONGODB_URI` in `db.ts`:** the first DB request will fail at runtime rather than at boot.

---

## 3. Required Environment Variables (Vercel)

These **must** be set in Vercel project settings for the application to function:

| Variable | Description | Example format (placeholder only) |
|----------|-------------|-----------------------------------|
| `MONGODB_URI` | MongoDB Atlas connection string (with `retryWrites=true&w=majority`) | `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/skills_connect_admin?retryWrites=true&w=majority` |
| `MONGODB_DB` | Database name | `skills_connect_admin` |
| `JWT_ACCESS_SECRET` | JWT access token signing secret (32+ random chars) | Base64-encoded 32+ bytes |
| `JWT_REFRESH_SECRET` | JWT refresh token signing secret (32+ random chars, different from access) | Base64-encoded 32+ bytes |

### Optional but strongly recommended

| Variable | Description | Notes |
|----------|-------------|-------|
| `ACCESS_TOKEN_TTL_MIN` | Access token lifetime | Default `15` |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh token lifetime | Default `7` |
| `COOKIE_SECURE` | Set `true` in production (HTTPS) | Currently hardcoded to `NODE_ENV === "production"` in `api-auth.ts` |
| `NEXT_PUBLIC_API_BASE_URL` | External API base | Leave empty for single Next.js deployment |
| `NEXT_PUBLIC_APP_NAME` | App display name | Defaults to nothing if unset |

### QuickBooks (required only if QB integration is used)

| Variable | Description |
|----------|-------------|
| `QB_CLIENT_ID` | Intuit OAuth client ID |
| `QB_CLIENT_SECRET` | Intuit OAuth client secret |
| `QB_REDIRECT_URI` | OAuth redirect URI (must match Intuit app config) |
| `QB_WEBHOOK_SECRET` | HMAC secret for webhook signature validation |
| `QB_ENCRYPTION_KEY` | AES-256-GCM key for QB token encryption at rest |
| `QB_AUTH_URL` | (override) QB OAuth authorization endpoint |
| `QB_TOKEN_URL` | (override) QB OAuth token endpoint |
| `QB_REALM_ID` | (override) QB realm ID |
| `QB_SANDBOX` | Set `"false"` for production (default `true`) |

---

## 4. Module Dependencies by Variable

### `MONGODB_URI`
- `src/lib/db.ts` — `getDb()`, `getClient()`, `collection()`
- `src/lib/mongodb.ts` — `connectDb()`
- All API routes that access collections transitively

### `MONGODB_DB`
- `src/lib/db.ts`, `src/lib/mongodb.ts` — database selection

### `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
- `src/lib/api-auth.ts` — `signAccessToken()`, `verifyAccessToken()`, `signRefreshToken()`
- `src/middleware/auth.ts` — `verifyToken()` (transitive via `api-auth`)

### `QB_*` variables
- `src/lib/quickbooks.ts` — all QB functions
- `src/app/api/integrations/quickbooks/*` — all QB routes

---

## 5. Startup Validation & Failure Modes

| Variable | Validated at startup? | Missing behavior |
|----------|----------------------|------------------|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Yes — `api-auth.ts` throws at import | Module fails to load; app cannot boot |
| `MONGODB_URI` (via `mongodb.ts`) | Yes — throws if missing | Module load fails |
| `MONGODB_URI` (via `db.ts`) | No | First DB request fails with connection error |
| `QB_*` variables | No | QB functions degrade gracefully (return errors/`null`) |
| All others | No | Sensible defaults applied |

---

## 6. Vercel Deployment Requirements

1. **Environment variables:** Add all Required variables above in Vercel Project Settings → Environment Variables. Do **not** add secrets to `.env.example` or commit them.
2. **Build command:** `npm run build` (already configured in `vercel.json`).
3. **Output directory:** Next.js default (`.next`).
4. **Middleware:** `src/middleware.ts` protects page routes; API routes self-authenticate. The "middleware" file convention deprecation warning is informational only.
5. **Database:** Ensure MongoDB Atlas cluster is reachable from Vercel (IP allowlist if needed). Run migration scripts against the target DB before first deploy:
   - `node scripts/migrate-master-data.mjs`
   - `node scripts/migrate-phase-5.mjs`
   Both are idempotent and non-destructive.
6. **No `.env` file:** `.env` is git-ignored and must not be committed. Provide values via Vercel UI only.

---

## 7. MongoDB Connection Configuration

- **Driver:** `mongodb ^6.8.0` (native driver).
- **Connection caching:** `db.ts` caches a single `MongoClient` and `Db` handle module-scoped. `mongodb.ts` uses a global cache in development to prevent multiple connections during hot reload; in production it creates a new client per module load (serverless-friendly).
- **Database name:** `MONGODB_DB` env var, defaults to `skills_connect_admin`.
- **Transactions:** Supported via `getClient()` + `startSession()` (used by commission payouts, payment allocation reversal, Excel import execution). Requires a replica set (Atlas provides this by default).
- **No connection pooling configuration** is exposed via env vars; driver defaults apply.

---

## 8. Authentication & Encryption Requirements

- **JWT access token:** HMAC-SHA256, 15 min TTL, stored in browser memory only.
- **Refresh token:** HMAC-SHA256, 7-day TTL, httpOnly cookie, SHA-256 hashed at rest in `refresh_tokens` collection.
- **Password hashing:** argon2id (via `argon2` package).
- **QB token encryption:** AES-256-GCM, key derived via scrypt from `QB_ENCRYPTION_KEY`. Degrades to raw storage if key missing (security risk — key should always be set when QB is used).
- **Cookie secure flag:** `NODE_ENV === "production"` (Vercel sets `NODE_ENV=production` automatically).

---

## 9. Storage Configuration

- **Documents:** Stored as binary in MongoDB `documents` collection (no S3/presigned URLs). 16 MB document size limit applies.
- **Excel/PDF exports:** Generated on-the-fly, not persisted.
- **File upload limits:** Documents 20 MB (PDF) / 10 MB (images); Excel 10 MB.

---

## 10. QuickBooks Configuration

See `docs/phase-6-quickbooks-verification.md` for full status. Summary:
- QB is **NOT verified** against live Intuit sandbox.
- All QB variables are optional at code level; integration degrades gracefully when absent.
- `QB_ENCRYPTION_KEY` is required for encrypted token storage at rest.

---

## 11. FX Provider Configuration

- No FX provider environment variables exist in the codebase.
- Exchange rate placeholder = 1 is hardcoded in `src/app/api/orders/route.ts` and `src/app/api/commission-records/route.ts`.
- See `docs/phase-6-fx-provider-audit.md` for full status.

---

## 12. Safe Environment Variable Checklist (Vercel)

Copy this list into Vercel Project Settings → Environment Variables. **Do not commit secrets to git.**

### Required (core application)
- [ ] `MONGODB_URI` — MongoDB Atlas connection string
- [ ] `MONGODB_DB` — `skills_connect_admin` (or target DB name)
- [ ] `JWT_ACCESS_SECRET` — 32+ random chars, unique
- [ ] `JWT_REFRESH_SECRET` — 32+ random chars, different from access secret

### Optional (defaults applied if omitted)
- [ ] `ACCESS_TOKEN_TTL_MIN` (default 15)
- [ ] `REFRESH_TOKEN_TTL_DAYS` (default 7)
- [ ] `NEXT_PUBLIC_API_BASE_URL` (leave empty for single Next.js service)
- [ ] `NEXT_PUBLIC_APP_NAME`

### QuickBooks (only if QB integration is enabled)
- [ ] `QB_CLIENT_ID`
- [ ] `QB_CLIENT_SECRET`
- [ ] `QB_REDIRECT_URI`
- [ ] `QB_WEBHOOK_SECRET`
- [ ] `QB_ENCRYPTION_KEY`
- [ ] `QB_SANDBOX` (set `"false"` for production)

### Pre-deploy steps
- [ ] Run `node scripts/migrate-master-data.mjs` against target DB
- [ ] Run `node scripts/migrate-phase-5.mjs` against target DB
- [ ] Verify `npm run build` exits 0
- [ ] Verify `vitest run` passes (uses in-memory MongoDB, not production)
- [ ] Verify `npx tsc --noEmit` passes
- [ ] Verify `npx oxlint` passes (warnings only acceptable)

### Do NOT
- [ ] Do not create or commit a `.env` file
- [ ] Do not print or log secret values
- [ ] Do not run migrations against production without a backup
- [ ] Do not connect automated tests to production MongoDB

---

## 13. Evidence Files

- `src/lib/db.ts` — MongoDB connection (db.ts variant)
- `src/lib/mongodb.ts` — MongoDB connection (mongodb.ts variant)
- `src/lib/api-auth.ts` — JWT secrets + eager validation
- `src/lib/quickbooks.ts` — QB env vars + graceful degradation
- `src/lib/api.ts` — `NEXT_PUBLIC_API_BASE_URL`
- `src/middleware/auth.ts` — Auth middleware (transitive JWT use)
- `src/app/api/integrations/quickbooks/webhook/route.ts` — `QB_WEBHOOK_SECRET`
- `.env.example` — Placeholder template (no real values)
- `vercel.json` — Build command configuration
- `next.config.ts` — Next.js config
