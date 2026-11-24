# Phase 8A — Deployment & Configuration Stabilization Report

**Repository:** Skills Connect Admin
**Branch:** `rony-dev`
**HEAD:** `ed043712fe1bb34793be97e1f5c53b3c76161f1c`
**Status:** COMPLETE
**Date:** 2026-11-23

---

## 1. Executive Summary

Phase 8A stabilized the deployment configuration and documentation for Skills Connect Admin. The `DEPLOYMENT.md` file previously described an Express 5 + BullMQ worker architecture that does not exist in the codebase. It has been rewritten to accurately describe the actual single Next.js 16 App Router application. The `render.yaml` manifest was missing `QB_ENCRYPTION_KEY` (required for QuickBooks OAuth token encryption), which has been added. A comprehensive `docs/ENVIRONMENT_VARIABLES.md` reference has been created.

No source code behavior was changed. No infrastructure was added. No secrets were exposed.

---

## 2. Initial Git State

| Item | Value |
|------|-------|
| Branch | `rony-dev` |
| HEAD | `ed043712fe1bb34793be97e1f5c53b3c76161f1c` |
| Working tree | 4 modified, 7 untracked (Phase 7 files) |
| Stash | None |

### Pre-existing modified files (preserved, untouched)

| File | Status |
|------|--------|
| `src/app/api/excel/imports/route.ts` | Modified — import history filtering |
| `src/components/layout/nav.ts` | Modified — Price Matrix Import nav item |
| `src/lib/permissions.ts` | Modified — Price Matrix import permission |
| `src/lib/store.ts` | Modified — Price Matrix Import client wrappers |

### Pre-existing untracked Phase 7 files

| File | Status |
|------|--------|
| `src/app/(app)/price-matrix-import/` | Untracked |
| `src/app/api/excel/price-matrix/` | Untracked |
| `src/views/price-matrix-import.tsx` | Untracked |
| `tests/price-matrix-import.test.ts` | Untracked |
| `docs/PHASE-7-FINAL-CLOSURE-REPORT.md` | Untracked |
| `docs/phase-7-step-14-*` | Untracked |
| `docs/phase-7-step-15-*` | Untracked |
| `docs/phase-7-step-17-*` | Untracked |
| `docs/phase-7-step-18-*` | Untracked |
| `docs/phase-7-step-19-*` | Untracked |

No existing user changes were overwritten or discarded.

---

## 3. Actual Deployment Architecture (verified)

### 3.1 Verified Architecture

| Component | File | Finding |
|-----------|------|---------|
| Framework | `package.json`, `next.config.ts` | Next.js 16.4.5 App Router |
| Runtime scripts | `package.json:7-13` | `next dev`, `next build`, `next start` |
| Deployment target | `render.yaml` | Single Render web service, port 3000 |
| Database | `src/lib/db.ts`, `render.yaml:28-33` | MongoDB Atlas via native driver |
| Auth | `src/middleware/auth.ts` | JWT access (15 min) + httpOnly rotating refresh cookie (7 days) |
| Password hashing | argon2id | Login security |
| File storage | `docs/setup/DEPLOYMENT.md` | MongoDB BSON Binary (no S3/MinIO/R2) |
| RBAC | `src/lib/permissions.ts` | 4 roles, server-side enforcement |
| Queue/worker | None | No BullMQ, no background worker |
| Rate limiting | `src/lib/rate-limit.ts` | In-process, no Redis dependency |

### 3.2 What Does NOT Exist (contrary to old DEPLOYMENT.md)

| Item | Status |
|------|--------|
| Express server | Does not exist |
| `server/` directory | Does not exist (gitignored) |
| BullMQ / ioredis | Not in `package.json` |
| Background worker | None |
| `npm run server:build` / `npm run server:start` | Not in `package.json` |
| Application Dockerfile | Does not exist |
| Separate frontend/backend services | Single Next.js service |

---

## 4. Outdated Documentation Corrected

### 4.1 `docs/setup/DEPLOYMENT.md` (rewritten)

The previous `DEPLOYMENT.md` described an Express 5 + BullMQ architecture that does not exist. It has been completely rewritten to describe the actual Next.js architecture.

**Removed (inaccurate content):**
- References to `server/src/server.ts`, `server/src/worker.ts`, `server/src/config/env.ts`, `server/.env.example` (none exist)
- References to `npm run server:build`, `npm run server:start`, `npm run server:seed`, `npm run server:smoke` (none exist)
- References to BullMQ + ioredis queue (not installed)
- References to separate API worker + frontend services (single Next.js service)
- Port 4000 (actual port is 3000)
- Redis as required for shared rate limiting (rate limiting is in-memory only)

**Added (accurate content):**
- Single Next.js application architecture table
- Required and optional environment variable table
- Production build (`npm run build`) and start (`npm run start`) commands
- Deployment workflow with health check (`/api/health/ready`)
- Redis provisioned but not integrated clarification
- QuickBooks as optional with `QB_ENCRYPTION_KEY` requirement
- Support section with MongoDB URI allowlist and cookie settings

### 4.2 `render.yaml` (targeted edit)

Added `QB_ENCRYPTION_KEY` as a `sync: false` secret in the QuickBooks section, since `src/lib/quickbooks.ts:49-53` requires it for AES-256-GCM token encryption. Without it, QuickBooks token storage fails closed.

### 4.3 `docs/ENVIRONMENT_VARIABLES.md` (created)

Complete inventory of all environment variables, categorized as required, optional, and QuickBooks-only. Includes `QB_ENCRYPTION_KEY` specifics (scrypt derivation, fail-closed behavior, rotation warning).

---

## 5. Environment Variable Inventory

Complete reference at `docs/ENVIRONMENT_VARIABLES.md`.

### Required (must be set in production)

| Variable | Purpose | Secret? |
|----------|---------|---------|
| `MONGODB_URI` | MongoDB Atlas connection string | Yes |
| `JWT_ACCESS_SECRET` | Access JWT signing key | Yes |
| `JWT_REFRESH_SECRET` | Refresh token signing key | Yes |

### Optional with defaults

| Variable | Default | Secret? |
|----------|---------|---------|
| `MONGODB_DB` | `skills_connect_admin` | No |
| `ACCESS_TOKEN_TTL_MIN` | `15` | No |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | No |
| `COOKIE_SECURE` | `false` (dev) / `true` (prod) | No |
| `COOKIE_SAME_SITE` | `lax` | No |
| `LOGIN_RATE_LIMIT_MAX` | `5` | No |
| `LOGIN_RATE_LIMIT_WINDOW_MIN` | `15` | No |
| `ACCOUNT_LOCK_MAX_FAILURES` | `10` | No |
| `ACCOUNT_LOCK_MINUTES` | `15` | No |
| `NEXT_PUBLIC_API_BASE_URL` | `""` | No |
| `NEXT_PUBLIC_APP_NAME` | `Skills Connect Admin` | No |
| `SEED_ADMIN_EMAIL` | `admin@example.com` | Yes |
| `SEED_ADMIN_PASSWORD` | `<12+ char password>` | Yes |
| `SEED_ADMIN_NAME` | `Super Admin` | No |

### QuickBooks (optional)

| Variable | Purpose | Secret? |
|----------|---------|---------|
| `QB_ENCRYPTION_KEY` | AES-256-GCM key derivation for QB token encryption | Yes |
| `QB_CLIENT_ID` | OAuth client ID | Yes |
| `QB_CLIENT_SECRET` | OAuth client secret | Yes |
| `QB_REALM_ID` | Company realm ID | Yes |
| `QB_WEBHOOK_SECRET` | Webhook signature verification | Yes |
| `QB_REDIRECT_URI` | OAuth redirect URI | No |
| `QB_SANDBOX` | Sandbox mode | No |
| `QB_TOKEN_URL` | Token endpoint override | No |
| `QB_AUTH_URL` | OAuth authorization endpoint override | No |
| `QB_INCOME_ACCOUNT_ID` | Income account ID for sync | No |

### Redis

`REDIS_URL` is **not referenced anywhere in application source code**. Redis is provisioned externally (`render.yaml`) but not integrated. Rate limiting is in-memory only.

---

## 6. QB_ENCRYPTION_KEY Findings

### Verified Implementation

**File:** `src/lib/quickbooks.ts:49-53`
```typescript
function encryptionKey(): Buffer | null {
  const secret = process.env.QB_ENCRYPTION_KEY;
  if (!secret) return null;
  return scryptSync(secret, "skills-connect-qb", 32);
}
```

### Behavior

| Scenario | Behavior |
|----------|----------|
| `QB_ENCRYPTION_KEY` set | AES-256-GCM encryption of QB OAuth tokens at rest |
| `QB_ENCRYPTION_KEY` missing | `encryptToken()` returns `null`; `exchangeCodeForTokens()` fails closed with `"QuickBooks encryption is not configured. Set QB_ENCRYPTION_KEY before connecting."` |
| Application startup | Starts successfully without the key; only QB token storage is affected |
| Changing the key | Makes existing encrypted tokens unreadable; do not rotate without re-encrypting |

### render.yaml

Added `QB_ENCRYPTION_KEY` as `sync: false` secret (must be set manually in Render dashboard).

---

## 7. Redis Verification Findings

| Question | Answer | Evidence |
|----------|--------|----------|
| Is Redis provisioned externally? | Yes | `render.yaml:80-82` provisions `skills-connect-redis` starter plan |
| Is Redis connection configured in app? | No | No `REDIS_URL` references in `src/` |
| Does app connect to Redis? | No | `src/lib/rate-limit.ts:8-9` — in-memory only |
| Is BullMQ installed? | No | Not in `package.json` |
| Is a worker running? | No | No worker scripts in `package.json` |
| Are production jobs dependent on Redis? | No | No background jobs exist |

**Conclusion:** Redis is provisioned but **not integrated**. Rate limiting is in-memory only (`src/lib/rate-limit.ts:8-9`). The `settings.tsx:7` status "Blocked — not provisioned" accurately reflects the application integration state, even though Redis exists externally.

---

## 8. Production Configuration Findings

| Aspect | File | Status |
|--------|------|--------|
| Build command | `package.json:8` | `next build` ✅ Verified |
| Start command | `package.json:9` | `next start` ✅ Verified |
| Port | `render.yaml:21` | 3000 ✅ |
| Host binding | `render.yaml:23` | 0.0.0.0 ✅ |
| Health check | `src/app/api/health/ready/route.ts` | MongoDB ping, returns 200/503 ✅ |
| Logging | `src/lib/audit.ts` | Structured audit logs, failures swallowed ✅ |
| Graceful shutdown | Not implemented | Next.js handles process signals |
| MongoDB connection | `src/lib/db.ts` | Native driver, cached client ✅ |
| Secrets logging | `src/lib/audit.ts:16-26` | `sanitizeAudit` strips known-sensitive keys ✅ |

No new health endpoint was introduced (existing `/api/health/ready` is sufficient).
No authentication behavior was changed.
No API contracts were modified.
No database schemas or indexes were modified.

---

## 9. Files Changed

| File | Action | Reason |
|------|--------|--------|
| `docs/setup/DEPLOYMENT.md` | Rewritten | Removed Express/BullMQ/`server/` references; documented actual Next.js architecture |
| `render.yaml` | Edited | Added `QB_ENCRYPTION_KEY` as `sync: false` secret |
| `docs/ENVIRONMENT_VARIABLES.md` | Created | Complete environment variable inventory |

### Pre-existing changes (not part of Phase 8A, preserved)

| File | Status |
|------|--------|
| `src/app/api/excel/imports/route.ts` | Modified — import history guard filtering |
| `src/components/layout/nav.ts` | Modified — Price Matrix Import nav item |
| `src/lib/permissions.ts` | Modified — Price Matrix import permission |
| `src/lib/store.ts` | Modified — Price Matrix Import client wrappers |

---

## 10. Validation Results

| Check | Command | Result |
|-------|---------|--------|
| Vitest suite | `npx vitest run` | **327 passed, 25 files, 0 failed** |
| Production build | `npm run build` | ✅ Success |
| Lint | `npm run lint` | Warnings only, 0 errors (all pre-existing) |
| vercel.json JSON | `node -c` | ✅ Valid |
| render.yaml structure | Node manual check | ✅ `QB_ENCRYPTION_KEY` with `sync: false` present |

### Child-process warning

`node.exe: A child-process didnt exit with signal "SIGINT" within 10 seconds, using "SIGKILL"` — MongoDB Memory Server teardown behavior, not a test failure. All 327 tests passed.

---

## 11. Remaining Blockers

| Blocker | Severity | Classification |
|---------|----------|----------------|
| Redis not wired to application | Medium | NOT VERIFIED — provisioned externally but not integrated |
| QuickBooks never tested against real Intuit API | High | DEFERRED — Phase 8C |
| FX policy not approved | High | DEFERRED — Phase 8B |
| `QB_ENCRYPTION_KEY` now documented in render.yaml | — | RESOLVED |
| Deployment documentation corrected | — | RESOLVED |
| Environment variable documentation created | — | RESOLVED |

---

## 12. Rollback Instructions

No source code behavior was changed. To roll back documentation changes:

1. Revert `docs/setup/DEPLOYMENT.md` to previous version (Express/BullMQ content)
2. Revert `render.yaml` to remove `QB_ENCRYPTION_KEY` entry
3. Delete `docs/ENVIRONMENT_VARIABLES.md`

No database migrations, no code changes, no deployment impact.

---

## 13. Final Status

**PHASE 8A STATUS: COMPLETE**

### Completion Criteria

| Criterion | Status |
|-----------|--------|
| Deployment documentation accurately reflects Next.js architecture | ✅ VERIFIED |
| No obsolete Express deployment instructions remain | ✅ VERIFIED |
| Environment variable documentation is accurate | ✅ VERIFIED |
| No secrets exposed | ✅ VERIFIED |
| QB_ENCRYPTION_KEY requirements correctly documented | ✅ VERIFIED |
| Redis provisioning vs application integration distinguished | ✅ VERIFIED |
| Deployment configuration consistent with package scripts | ✅ VERIFIED |
| Required validation passes | ✅ VERIFIED |
| Existing user changes preserved | ✅ VERIFIED |

### Production Deployment Approval

**NOT APPROVED** by this report. Production deployment requires:
1. QuickBooks sandbox credentials and testing (Phase 8C)
2. FX policy approval (Phase 8B)
3. Background job worker decision (Phase 8F)
4. Full UAT and security testing (Phase 8H)

This report stabilizes documentation and configuration only. It does not authorize deployment.

---

**Report path:** `docs/PHASE-8A-DEPLOYMENT-CONFIGURATION-REPORT.md`
