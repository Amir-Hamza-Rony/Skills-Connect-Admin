# Phase 7 Step 15 — Maintenance Mode Architecture and Deployment Documentation Audit

**Repository:** Skills Connect Admin
**Branch:** `rony-dev`
**HEAD:** `ed043712fe1bb34793be97e1f5c53b3c76161f1c`
**Audit type:** Read-only architecture investigation
**Date:** 2026-11-23

---

## 1. Executive Summary

This audit evaluates whether a safe maintenance-mode mechanism for Price Matrix imports can be implemented within the current Next.js + MongoDB Atlas architecture, and prepares a corrected deployment documentation plan based on the actual (not documented) architecture.

**Key findings:**

- The architecture is a **single Next.js App Router application** serving both frontend and API routes. `next dev` / `next build` / `next start` are the only scripts. Render runs one web service on port 3000.
- **Redis is provisioned in `render.yaml` but NOT wired into the application** (`settings.tsx:7` confirms "Blocked — not provisioned"). No BullMQ, no background worker, no job queue exists.
- **No maintenance mode, no import-disable mechanism, no process registry, no lease/heartbeat, no fencing token exists.**
- The Price Matrix import guard mechanism is implemented and tested (35/35 tests pass, full suite 327/327 pass).
- Guard documents use deterministic `_id` with `ownerToken` for ownership-verified cleanup. Cleanup failures are logged/audited.
- `createdAt` alone **cannot** establish whether a guard is orphaned.
- **Deployment documentation (`DEPLOYMENT.md`) drifts significantly** — references Express, BullMQ worker, `server/` directory, and `server:build`/`server:start` scripts that do not exist in the codebase.
- **Safe orphan recovery cannot be fully automated** without active-import tracking, because the current architecture cannot prove an import has stopped.

**Recommendation:** Maintenance mode can be implemented as a database-backed flag in the existing `excel_imports` collection (no new collection required). However, safe orphan recovery still requires external operator confirmation — maintenance mode alone is insufficient. Documentation drift in `DEPLOYMENT.md` must be corrected before production deployment.

---

## 2. Current Architecture Verification

### 2.1 Verified Architecture

| Component | File | Finding |
|-----------|------|---------|
| Framework | `package.json`, `next.config.ts` | Next.js 16.4.5 App Router, `next dev`/`next build`/`next start` |
| Deployment target | `render.yaml` | Single Render web service, `startCommand: "npm run start"` (Next.js production server on port 3000) |
| Database | `src/lib/db.ts`, `render.yaml:28-33` | MongoDB Atlas via `MONGODB_URI`, DB name `skills_connect_admin` |
| Redis | `render.yaml:80-82`, `src/views/settings.tsx:7` | Provisioned but **not wired** — "Blocked — not provisioned" |
| Worker/queue | None | No BullMQ, no background worker, no job queue scripts in `package.json` |
| `server/` directory | None | Does not exist (referenced in DEPLOYMENT.md but absent from repo) |
| Process scripts | `package.json:7-13` | Only `dev`, `build`, `start`, `seed:admin`, `lint`, `test`, `typecheck` |

### 2.2 Git-State Verification

| Item | Value |
|------|-------|
| Branch | `rony-dev` |
| HEAD | `ed043712fe1bb34793be97e1f5c53b3c76161f1c` |
| Working tree | 3 modified, 7 untracked (including Step 14 report) |
| Stash | None |

### 2.3 Modified Files (Pre-existing, Not Part of This Audit)
| File | Status |
|------|--------|
| `src/app/api/excel/imports/route.ts` | Modified — import history filtering |
| `src/components/layout/nav.ts` | Modified |
| `src/lib/permissions.ts` | Modified |
| `src/lib/store.ts` | Modified |

### 2.4 Untracked Phase 7 Files
| File | Status |
|------|--------|
| `src/app/(app)/price-matrix-import/` | Untracked |
| `src/app/api/excel/price-matrix/` | Untracked |
| `src/views/price-matrix-import.tsx` | Untracked |
| `tests/price-matrix-import.test.ts` | Untracked |
| `docs/phase-7-step-14-operational-recovery-audit.md` | Untracked |

---

## 3. Maintenance-Mode Design Comparison

Four approaches were evaluated against the existing architecture.

### Approach A: Database-Backed Maintenance Flag in `excel_imports`

| Criterion | Assessment |
|-----------|------------|
| Works across multiple Render instances | Yes — MongoDB is shared; flag is read from DB on each request |
| Survives application restarts | Yes — persisted in MongoDB |
| Requires new collection or index | No — uses existing `excel_imports` collection |
| Admin-controllable | Yes — SUPER_ADMIN toggles flag via direct DB write or admin endpoint |
| Race conditions | Low — check-then-block is per-request; window between flag check and guard insert is small |
| Blocks unrelated Excel imports | No — flag can be scoped to Price Matrix imports only |
| Auditable | Yes — flag changes can be written to `audit_logs` |
| Operational complexity | Low |

### Approach B: Environment-Variable-Based Maintenance Switch

| Criterion | Assessment |
|-----------|------------|
| Works across multiple instances | Only if all instances are restarted simultaneously |
| Survives application restarts | Yes — env var persists |
| Requires new collection or index | No |
| Admin-controllable | Partially — requires env var change + redeploy/restart |
| Race conditions | None (flag is static during process lifetime) |
| Blocks unrelated Excel imports | No |
| Auditable | No — env var changes are not auditable within the app |
| Operational complexity | High — requires deploy/restart to toggle |

### Approach C: Application-Level Configuration with Admin-Controlled Setting

| Criterion | Assessment |
|-----------|------------|
| Works across multiple instances | Yes — if stored in shared DB |
| Survives application restarts | Yes |
| Requires new collection or index | Yes — new settings collection or document |
| Admin-controllable | Yes — via admin UI or direct DB write |
| Race conditions | Low |
| Blocks unrelated Excel imports | No — can be scoped |
| Auditable | Yes — settings changes auditable |
| Operational complexity | Medium — requires new collection/document |

### Approach D: Dedicated Maintenance-Control Record with Explicit Authorization

| Criterion | Assessment |
|-----------|------------|
| Works across multiple instances | Yes — MongoDB shared |
| Survives application restarts | Yes |
| Requires new collection or index | No — can use existing `excel_imports` |
| Admin-controllable | Yes — SUPER_ADMIN creates/deletes maintenance record |
| Race conditions | Low — atomic insert/delete on `_id` |
| Blocks unrelated Excel imports | No — record can be scoped to `type: "price_matrix_maintenance"` |
| Auditable | Yes — record creation/deletion can be audited |
| Operational complexity | Low |

**Recommendation: Approach A** (database-backed maintenance flag in existing `excel_imports` collection). It requires no new collection, works across instances, survives restarts, is admin-controllable, and is auditable. The flag should be scoped with `type: "price_matrix_maintenance"` to avoid blocking unrelated Excel imports.

---

## 4. Active-Import Coordination Design

### 4.1 The Critical Problem

The current architecture **cannot reliably determine whether an import is active**. Here is why:

| Information Source | Can It Prove Active Import? | Reason |
|-------------------|----------------------------|--------|
| Guard document existence | No | Guard may be orphaned from a crashed import |
| Guard `createdAt` timestamp | No | An active import could have started long ago |
| Guard `ownerToken` | No | Cannot determine if token owner process is still alive |
| Supplier-route records | No | Import may have acquired guard but not yet inserted route |
| Audit logs | No | Audit records are written after import completes, not during |
| Process registry | Does not exist | No process tracking in the application |
| Heartbeat/lease | Does not exist | No heartbeat mechanism |
| Import job records | Do not exist for Price Matrix | Unlike `excel/import/route.ts`, Price Matrix imports create no job records |

### 4.2 Why Maintenance Mode Alone Is Insufficient

Maintenance mode can **block new imports** but cannot **safely identify active imports**. The sequence below shows the limitation:

```
1. Administrator enables maintenance mode → new imports blocked ✅
2. Import A was already running before maintenance mode → guard exists ✅
3. Import A crashes mid-execution → guard becomes orphan ⚠️
4. Operator sees guard and cannot tell if Import A is still running or crashed ⚠️
5. Operator deletes guard → if Import A was still running, two concurrent imports possible ⚠️
```

### 4.3 What Additional Tracking Is Necessary

For safe orphan recovery, **at least one** of the following is required:

1. **Persistent import job records** — Create a record in `excel_imports` with `status: "processing"` when an import starts, update to `completed`/`failed` when it ends. Recovery can check for `status: "processing"` records to determine if an import is active.

2. **Lease/heartbeat with TTL** — Guard document includes `leaseExpiresAt`; active imports renew the lease. Recovery checks if lease has expired. Requires background renewal mechanism (not currently available).

3. **Fencing token** — Monotonically increasing token on each route insert; stale owners cannot write after lock expiry. Requires application-level fencing logic.

None of these exist in the current codebase. Implementing them requires code changes beyond the scope of this audit.

---

## 5. Safe Recovery Workflow

### 5.1 Recovery Preconditions (All Must Be Met)

| Precondition | How to Verify |
|--------------|---------------|
| Maintenance mode enabled | Check maintenance flag in `excel_imports` |
| No new imports can start | Maintenance flag blocks `POST /api/excel/price-matrix/import` |
| Operator confirms no active import | External observation — no users on import page, check application logs |
| Exact guard identified | Query `excel_imports` for `type: "price_matrix_lock"` |
| Guard ownership verified | Guard document has `qualificationId`, `rtoId`, `ownerToken` |

### 5.2 Recovery Procedure

```
1. Enable maintenance mode (set flag in excel_imports)
2. Confirm no Price Matrix import UI pages are open
3. Check application logs for in-progress import requests
4. Query excel_imports for guard documents with type: "price_matrix_lock"
5. For each guard: inspect qualificationId, rtoId, ownerToken, createdAt
6. Cross-reference with audit_logs for recent import activity on same qualification+RTO
7. Operator confirms (externally) that no import process is running
8. Delete exact guard: deleteOne({ _id, type: "price_matrix_lock" })
9. Verify deletedCount === 1
10. Write audit record for manual recovery
11. Disable maintenance mode (remove flag)
12. Retry import if needed
```

### 5.3 What Must NOT Be Done

| Prohibited Action | Reason |
|-------------------|--------|
| Delete guard based on `createdAt` age alone | Active import could have started long ago |
| Use `deleteMany` | Would delete guards for other combinations |
| Delete without matching `type: "price_matrix_lock"` | Could delete normal import job records |
| Automated recovery endpoint | Cannot verify import has stopped |
| Delete guard belonging to another instance's active import | Would enable concurrent overlapping imports |

---

## 6. Concurrency and Failure Scenario Analysis

| Scenario | Expected Behavior | Possible Failure | Current Implementation Support |
|----------|------------------|------------------|-------------------------------|
| Two admins enable maintenance mode simultaneously | Both inserts succeed (atomic `_id`), flag set once | Second insert gets 11000 — harmless | Partial — no maintenance flag exists yet |
| New import starts at same time maintenance enabled | Race: import may pass flag check before flag is set | Import proceeds during maintenance | Not supported — no flag exists |
| Import already running when maintenance enabled | Import completes normally | Guard exists but import still running | Cannot detect — no active-import tracking |
| Render process restarts during import | Guard becomes orphaned | Permanent block on that combination | Not recoverable safely without operator confirmation |
| MongoDB temporarily unavailable | Import fails with SERVER_ERROR | Guard may or may not be cleaned up | Partially — `finally` block runs cleanup |
| Import loses guard unexpectedly | Orphaned guard blocks future imports | Permanent block | Not recoverable safely |
| Operator attempts recovery while import running | Guard deleted → concurrent imports possible | Overlapping supplier routes created | Not prevented — no fencing token |
| Two operators attempt recovery simultaneously | Both deleteOne; second gets deletedCount=0 | Second operator gets warning | Supported — `deletedCount` check |
| Maintenance disabled before recovery complete | New imports can start | Overlap with recovery in progress | Not prevented — no coordination |

---

## 7. RBAC and Audit Recommendations

### 7.1 Permission Requirements

| Operation | Required Permission | Rationale |
|-----------|-------------------|-----------|
| Enable/disable maintenance mode | `settings.manage` (existing) or new `price_matrix.maintenance` | Maintenance mode is a settings-level operation; SUPER_ADMIN and ADMIN already have `settings.manage` |
| View maintenance status | `pricing.manage` (existing) or `reports.view` | Read-only status check |
| Manual guard recovery | `settings.manage` (existing) or SUPER_ADMIN | Destructive operation; should be restricted |
| View audit logs | `audit.view` (existing) | SUPER_ADMIN, ADMIN have this |

### 7.2 Current Permission Mapping

| Role | `pricing.manage` | `settings.manage` | `audit.view` |
|------|-----------------|-------------------|--------------|
| SUPER_ADMIN | ✅ | ✅ | ✅ |
| ADMIN | ✅ | ✅ | ✅ |
| BDC | ❌ | ❌ | ❌ |
| B2B_AGENT | ❌ | ❌ | ❌ |

**Recommendation:** Use existing `settings.manage` permission for maintenance mode operations. No new permission is required. SUPER_ADMIN and ADMIN can enable/disable maintenance and perform recovery. This is consistent with the existing RBAC pattern.

### 7.3 Audit Requirements

All maintenance-mode changes must be audited:

| Action | `entityType` | `action` | `after` fields |
|--------|-------------|----------|----------------|
| Enable maintenance | `excel_price_matrix` | `maintenance_enabled` | `{ flagId, operatorId, timestamp }` |
| Disable maintenance | `excel_price_matrix` | `maintenance_disabled` | `{ flagId, operatorId, timestamp }` |
| Manual guard recovery | `excel_price_matrix` | `guard_manual_recovery` | `{ guardId, qualificationId, rtoId, operatorId, deletedCount }` |

### 7.4 Unauthorized Access Handling

- `withAuth("settings.manage")` returns 403 for non-privileged roles
- SUPER_ADMIN bypasses permission check (existing behavior in `auth.ts:55-57`)
- No new RBAC code required; existing `withAuth`/`requirePermission` pattern suffices

---

## 8. Deployment Documentation Correction Outline

### 8.1 Outdated References in `DEPLOYMENT.md`

| Line(s) | Outdated Content | Correction Required |
|---------|-----------------|---------------------|
| 11 | `server/src/server.ts` — BullMQ worker | File does not exist; remove reference |
| 12 | `server/src/worker.ts` — background worker | File does not exist; remove reference |
| 15 | `server/.env.example` — missing `START_BACKGROUND_JOBS` | Directory does not exist; remove reference |
| 25-26 | Backend: Express 5 + TS + Mongoose | Actual: Next.js App Router API routes |
| 30-31 | Queue: BullMQ + Redis | Actual: Not provisioned (`settings.tsx:7`) |
| 32 | Docker deploy: Containerised | No application Dockerfile exists |
| 106-109 | API + Worker as separate services | Actual: Single Next.js web service |
| 108-109 | Build: `npm run server:build`, Start: `npm run server:start` | Actual: `npm run build`, `npm run start` |
| 119 | `npm run server:seed` | Actual: `npm run seed:admin` |
| 131 | `npm run server:smoke` | Script does not exist |
| 32 | Docker deploy: Containerised | No Dockerfile for application |
| 170 | `render.yaml` creates API + worker + frontend + Redis | `render.yaml` creates single Next.js web service + unwired Redis |

### 8.2 Corrected Documentation Outline

A corrected `DEPLOYMENT.md` should cover:

1. **Project architecture** — Single Next.js App Router application, frontend + API combined
2. **Required environment variables** — `MONGODB_URI`, `MONGODB_DB`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, etc. (from `render.yaml`)
3. **MongoDB Atlas configuration** — Cluster `skills_connect_admin`, IP allowlist
4. **Render web service configuration** — `npm run build`, `npm run start`, port 3000
5. **Build and start commands** — `npm ci && npm run build`, `npm run start`
6. **Redis status** — Provisioned but NOT wired; rate limiting falls back to in-process counters
7. **Local development setup** — `npm run dev` (Next.js on port 3000), `docker compose up -d` (Redis only)
8. **Production deployment workflow** — Connect repo to Render, use `render.yaml` blueprint, fill sync:false env vars
9. **Application restart behavior** — `next start` restarts process; no graceful shutdown hook for guard cleanup
10. **API request timeout considerations** — No `maxDuration` configured; Render default (~100s) applies
11. **Background job limitations** — No background worker; Redis not wired; no BullMQ
12. **Price Matrix import guard behavior** — Per-RTO+Qualification mutual exclusion via `excel_imports` guard documents; ownerToken for cleanup ownership
13. **Maintenance-mode operation** — Not yet implemented; manual coordination required
14. **Orphan guard recovery procedure** — Manual `deleteOne` with operator confirmation; age-based deletion prohibited
15. **Backup and operational safety** — MongoDB Atlas backups; audit logs for guard operations

---

## 9. Recommended Implementation Phases

### Phase 1: Minimum Changes for Safe Maintenance Mode

| Change | File | New Collection/Index? | Tests Required | Security Considerations |
|--------|------|----------------------|----------------|------------------------|
| Maintenance flag check in Price Matrix import route | `src/app/api/excel/price-matrix/import/route.ts` | No | Flag blocks import, flag allows import | SUPER_ADMIN only via `settings.manage` |
| Maintenance flag enable/disable (admin endpoint or DB write) | New or existing admin route | No | Enable blocks, disable allows | Audit all flag changes |
| Import history already filters guards | `src/app/api/excel/imports/route.ts` | No | Already tested | No change needed |

### Phase 2: Reliable Active-Import Tracking

| Change | File | New Collection/Index? | Tests Required | Security Considerations |
|--------|------|----------------------|----------------|------------------------|
| Import job records for Price Matrix | `src/app/api/excel/price-matrix/import/route.ts` | No (uses `excel_imports`) | Job created on start, completed/failed on end | Actor attribution, no secrets |
| Active-import check before guard recovery | Recovery procedure (documented) | No | Recovery blocked if `status: "processing"` | SUPER_ADMIN only |
| Maintenance mode + active-import status API | New admin endpoint | No | Status returns active imports | `settings.manage` |

### Phase 3: Safe Orphan Recovery

| Change | File | New Collection/Index? | Tests Required | Security Considerations |
|--------|------|----------------------|----------------|------------------------|
| Manual recovery endpoint | New API route | No | Recovery succeeds, blocked if active import | SUPER_ADMIN, audit all actions |
| Orphan detection UI | Frontend page | No | Shows guard documents with details | `settings.manage` |

### Documentation-Only Corrections

| Change | File |
|--------|------|
| Correct DEPLOYMENT.md architecture description | `docs/setup/DEPLOYMENT.md` |
| Update start/build commands | `docs/setup/DEPLOYMENT.md` |
| Remove Express/BullMQ/server/ references | `docs/setup/DEPLOYMENT.md` |
| Add Price Matrix guard behavior docs | `docs/setup/DEPLOYMENT.md` or new doc |
| Add orphan recovery runbook | New doc or `docs/setup/` |

### Future Improvements (Not Recommended for Immediate Implementation)

| Improvement | Reason Not Recommended Now |
|-------------|---------------------------|
| Lease + heartbeat + fencing tokens | Requires background worker/Redis wiring — not available |
| TTL index on guards | Could delete active lock; no evidence of safe import duration |
| Separate background worker | Requires new service, Redis wiring — substantial architecture change |
| Fencing tokens on route inserts | Requires application-level fencing logic — complex |

---

## 10. Remaining Risks and Unresolved Decisions

| Risk | Severity | Status | Resolution Required |
|------|----------|--------|-------------------|
| Crash-created orphan guard blocks combination permanently | High | Unresolved | Manual operator confirmation + `deleteOne` |
| Active import mistakenly treated as orphan | Critical | Unresolved | Cannot verify import has stopped without active-import tracking |
| Concurrent import during recovery | Medium | Unresolved | Maintenance window + operator coordination |
| Stale-owner supplier-route write | Medium | Unresolved | OwnerToken doesn't prevent stale writes; fencing needed |
| Deployment documentation drift | High | Unresolved | DEPLOYMENT.md must be corrected |
| No maintenance mode exists | Medium | Unresolved | Phase 1 implementation required |
| Redis provisioned but not wired | Low | Known limitation | Rate limiting falls back to in-process counters |

### Unresolved Technical Limitations

1. **Cannot prove an import has stopped** — No process registry, heartbeat, lease, or import job record for Price Matrix imports. Manual recovery requires external operator confirmation.

2. **OwnerToken does not prevent stale writes** — A stale owner whose guard was deleted could still call `insertOne` on `supplier-routes`. No fencing token exists.

3. **Render process restart during import** — Can interrupt import and leave orphan guard. No graceful shutdown hook for guard cleanup.

4. **No automated recovery endpoint** — Cannot be safely built without active-import tracking (Phase 2).

---

## 11. Report File Path

**Saved to:** `docs/phase-7-step-15-maintenance-mode-architecture-audit.md`

---

## Confirmations

- **No source code modified** — read-only audit only
- **No production data accessed** — source code and documentation inspection only
- **No Git history modified** — branch `rony-dev`, HEAD `ed04371`, working tree unchanged
- **No deployment modified** — no commits, pushes, or deployments
- **No MongoDB commands executed** — all database operations described as documentation examples only
- **No credentials exposed** — no connection strings, secrets, or personal information in this report

**Critical conclusion:** Maintenance mode can block new imports, but **safe orphan recovery cannot be guaranteed** without active-import tracking. The current architecture cannot prove an import has stopped. Maintenance mode alone is insufficient for safe recovery — it must be combined with external operator confirmation and, ideally, Phase 2 import job tracking.
