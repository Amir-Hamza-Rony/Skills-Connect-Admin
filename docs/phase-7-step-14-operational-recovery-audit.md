# Phase 7 Step 14 — Operational Recovery Procedure and Documentation Audit

**Repository:** Skills Connect Admin
**Branch:** `rony-dev`
**HEAD:** `ed043712fe1bb34793be97e1f5c53b3c76161f1c`
**Audit type:** Read-only investigation
**Date:** 2026-11-23

---

## 1. Executive Summary

This audit reviewed the Phase 7 Price Matrix import guard recovery mechanism, operational safety, audit observability, and deployment documentation accuracy.

**Key findings:**

- The Price Matrix import guard mechanism is implemented and tested (35/35 tests pass, full suite 327/327 pass).
- Guard documents use deterministic `_id` (`price_matrix_lock:${qualOid}:${rtoOid}`) with `ownerToken` for ownership-verified cleanup.
- Cleanup failures are logged to stderr and written as audit records (`guard_cleanup_ownership_mismatch`, `guard_cleanup_failed`).
- Import history API (`GET /api/excel/imports`) correctly excludes guard documents via `type: { $ne: "price_matrix_lock" }`.
- **No maintenance mode, no process registry, no lease/heartbeat, no automated recovery endpoint exists.** Manual recovery cannot be fully verified as safe without external operator confirmation.
- **Deployment documentation (`DEPLOYMENT.md`) drifts significantly from actual implementation** — references Express, BullMQ worker, `server/` directory that do not exist in the codebase.

**Recommendation:** The implementation is safe for normal concurrent operation. Manual recovery requires an explicitly controlled operational procedure. Documentation drift should be corrected before production deployment.

---

## 2. Git-State Verification

| Item | Value |
|------|-------|
| Branch | `rony-dev` |
| HEAD | `ed043712fe1bb34793be97e1f5c53b3c76161f1c` |
| Working tree | 3 modified, 5 untracked Phase 7 files |
| Stash | None |

### Modified Files
| File | Status |
|------|--------|
| `src/app/api/excel/imports/route.ts` | Modified — import history filtering |
| `src/components/layout/nav.ts` | Modified (pre-existing) |
| `src/lib/permissions.ts` | Modified (pre-existing) |
| `src/lib/store.ts` | Modified (pre-existing) |

### Untracked Phase 7 Files
| File | Status |
|------|--------|
| `src/app/(app)/price-matrix-import/` | Untracked |
| `src/app/api/excel/price-matrix/` | Untracked |
| `src/views/price-matrix-import.tsx` | Untracked |
| `tests/price-matrix-import.test.ts` | Untracked |

No commits, pushes, resets, checkouts, or stashes were performed during this audit.

---

## 3. Guard Recovery Architecture

### 3.1 Guard Document Structure

Guard documents are stored in the existing `excel_imports` collection:

```json
{
  "_id": "price_matrix_lock:<qualOid>:<rtoOid>",
  "type": "price_matrix_lock",
  "qualificationId": "<qualOid string>",
  "rtoId": "<rtoOid string>",
  "ownerToken": "<randomUUID v4>",
  "createdAt": "<ISO date>"
}
```

**Source:** `src/app/api/excel/price-matrix/import/route.ts:261-275`

### 3.2 Guard Ownership Verification

Ownership is verified through a two-part mechanism:

1. **`guardInserted` flag** — A per-request boolean variable, set to `true` only after `insertOne` succeeds (line 276). This flag is local to the request scope; no other request can set it to `true` for the same `guardId` because MongoDB's `_id` unique index guarantees only one successful insert.

2. **Owner-verified cleanup** — Cleanup uses `deleteOne({ _id: guardId, ownerToken })` (lines 369-372). The `ownerToken` is a `randomUUID()` generated per request (line 263). Only the request that successfully inserted the guard has `guardInserted === true` and calls `deleteOne` with its own `ownerToken`.

3. **`deletedCount` check** — If `deletedCount === 0`, another request already removed the guard (ownership lost). This is logged but not treated as fatal (lines 373-389).

**Limit:** OwnerToken protects cleanup ownership only. It does NOT prevent a stale owner from continuing to write supplier routes after losing ownership. No fencing token exists.

### 3.3 Cleanup Failure Handling

Two audit actions are defined:

| Action | Trigger | Severity | Stderr Logged | Audit Written |
|--------|---------|----------|---------------|---------------|
| `guard_cleanup_ownership_mismatch` | `deletedCount === 0` | Warning | Yes (line 376) | Yes (line 380) |
| `guard_cleanup_failed` | `deleteOne` throws | Error | Yes (line 392) | Yes (line 396) |

Both failures are caught and **do not override** the original import result. The API response reflects the import outcome regardless of cleanup status.

### 3.4 Audit Fields Available for Investigation

Audit records (`audit_logs` collection) include:

| Field | Description |
|-------|-------------|
| `actorId` | User ID who triggered the import |
| `actorEmail` | User email |
| `entityType` | `"excel_price_matrix"` |
| `entityId` | `null` (not set) |
| `action` | `"import"`, `"guard_cleanup_ownership_mismatch"`, `"guard_cleanup_failed"` |
| `before` | `null` |
| `after` | `{ guardId, qualificationId, rtoId }` or `{ totalRows, imported, pending, errors }` |
| `createdAt` | Timestamp |

Audit writes are intentionally swallowed on failure — they never break the primary operation (`src/lib/audit.ts:68-71`).

### 3.5 Information Unavailable After Crash

When a process crashes before cleanup, the following cannot be determined from the database alone:

- Whether the import process is still running
- Whether the guard is orphaned or actively held
- Which `ownerToken` belongs to a live vs. dead process
- Whether any supplier-route insert was attempted before the crash

A guard's `createdAt` timestamp **alone is not proof** that it is orphaned.

---

## 4. Manual Recovery Runbook

### A. Initial Incident Investigation

**Step 1: Identify affected Qualification and RTO**

Query the `excel_imports` collection for guard documents:

```javascript
// Example only — do not execute against production
db.excel_imports.find({ type: "price_matrix_lock" }).toArray()
```

Each guard document contains `qualificationId` and `rtoId` as string fields. Use these to look up the corresponding records in the `qualifications` and `rtos` collections.

**Step 2: Identify exact guard ID**

The guard `_id` follows the pattern: `price_matrix_lock:<qualOid>:<rtoOid>`

**Step 3: Inspect the guard document**

```javascript
// Example only — do not execute against production
db.external_imports.findOne({
  _id: "price_matrix_lock:<qualOid>:<rtoOid>",
  type: "price_matrix_lock"
})
```

Record: `ownerToken`, `createdAt`, `qualificationId`, `rtoId`.

**Step 4: Inspect related supplier-route records**

```javascript
// Example only — do not execute against production
db.supplier_routes.find({
  qualificationId: ObjectId("<qualOid>"),
  rtoId: ObjectId("<rtoOid>"),
  status: "active"
}).toArray()
```

Determine whether any active routes exist and whether they overlap with the intended import dates.

**Step 5: Review relevant audit records**

```javascript
// Example only — do not execute against production
db.audit_logs.find({
  entityType: "excel_price_matrix",
  action: { $in: ["guard_cleanup_ownership_mismatch", "guard_cleanup_failed"] }
}).sort({ createdAt: -1 }).toArray()
```

Look for cleanup failures related to the same `guardId`.

**Step 6: Determine whether an import may still be running**

**Limitation:** The current architecture cannot prove that an import has stopped. There is no process registry, no heartbeat, no lease, no import job record for Price Matrix imports. An operator must use external observation (e.g., confirm no users are actively on the Price Matrix import page, check application logs for in-progress requests).

---

### B. Stop Concurrent Activity

**No maintenance mode or import-disable feature exists in the codebase.**

Search results confirm:
- No maintenance mode endpoint or feature flag
- No import disable mechanism
- No application-level coordination for blocking imports

**Required:** A coordinated maintenance window or controlled application-level restriction is required. Options:

1. **Schedule a maintenance window** during which no Price Matrix imports are performed.
2. **Communicate to operators** to avoid Price Matrix imports during recovery.
3. **Deploy application-level restriction** (would require code change — outside scope of this audit).

---

### C. Verify Active Imports Have Stopped

**Required evidence before removing a guard:**

1. No Price Matrix import requests are in progress (confirmed via external observation — application logs, user coordination).
2. The guard document exists in `excel_imports` with `type: "price_matrix_lock"`.
3. The operator has verified the exact `_id`, `qualificationId`, and `rtoId`.

**What is NOT sufficient evidence:**
- Guard `createdAt` timestamp being "old" — an active import could have started long ago and still be running
- MongoDB inspection alone — cannot prove whether an application request is still executing
- Absence of supplier-route records — the import may have acquired the guard but not yet inserted the route

**Architecture limitation:** The current codebase cannot prove that an import has stopped. Manual recovery must remain an explicitly controlled operational procedure, not an automated endpoint.

---

### D. Manual Guard Removal

**Procedure (example commands — do not execute against production):**

```javascript
// 1. Inspect the guard document before deletion
const guard = db.external_imports.findOne({
  _id: "price_matrix_lock:<qualOid>:<rtoOid>",
  type: "price_matrix_lock"
});
printjson(guard);

// 2. Verify qualificationId and rtoId match the intended target
// 3. Confirm operator confirmation (external, not via database)

// 4. Delete ONLY the exact guard document
const result = db.external_imports.deleteOne({
  _id: "price_matrix_lock:<qualOid>:<rtoOid>",
  type: "price_matrix_lock"
});
printjson(result);

// 5. Verify deletion result
// Expected: { acknowledged: true, deletedCount: 1 }
// If deletedCount === 0, the guard was already removed or never existed
```

**Safety constraints:**
- Target only the exact guard `_id`
- Match `type: "price_matrix_lock"` in the query
- Verify `qualificationId` and `rtoId` before deletion
- Inspect the document before deletion
- Never use `deleteMany`
- Never delete normal Excel import job records (documents without `type: "price_matrix_lock"`)
- Verify the exact deletion result (`deletedCount === 1`)

**Audit trail:** Record operator, timestamp, reason, affected IDs (`guardId`, `qualificationId`, `rtoId`), and outcome (`deletedCount`) in an external change log or ticket system. The database does not automatically audit manual deletions of guard documents.

---

### E. Post-Recovery Verification

| Check | Method | Expected Result |
|-------|--------|-----------------|
| Guard removal | Query `excel_imports` for the guard `_id` | No documents with `type: "price_matrix_lock"` for that combination |
| Supplier-route consistency | Query `supplier-routes` for active routes | Expected routes present; no unexpected overlaps |
| Import history integrity | `GET /api/excel/imports` | Normal import records visible; no guard documents |
| Audit trail | Query `audit_logs` | Import and cleanup events present |
| Safe retry | Re-attempt Price Matrix import for the combination | Guard acquired successfully; import proceeds |

---

## 5. Import History and Audit Logs Review

### 5.1 Import History Filtering

**File:** `src/app/api/excel/imports/route.ts:91-94`

The list endpoint now excludes guard documents:

```typescript
const filter: Record<string, unknown> = {};
if (status) filter.status = status;
filter.type = { $ne: "price_matrix_lock" };
```

**Impact verification:**

| Record Type | Has `type` field? | Excluded? | Visible in UI? |
|-------------|-------------------|-----------|----------------|
| Normal Excel import job | No | No | ✅ Yes |
| Legacy record without `type` | No | No | ✅ Yes |
| Price Matrix guard document | Yes (`price_matrix_lock`) | Yes | ❌ No |

**Test coverage:** `tests/price-matrix-import.test.ts` includes "import history excludes guard documents but preserves normal records" — 3 normal/legacy records + 1 guard = 2 visible imports.

### 5.2 Audit Log Review

**File:** `src/lib/audit.ts:55-72`

Audit fields available for guard-related investigations:

| Field | Guard cleanup failure | Guard ownership mismatch |
|-------|----------------------|--------------------------|
| `actorId` | ✅ | ✅ |
| `actorEmail` | ✅ | ✅ |
| `entityType` | `"excel_price_matrix"` | `"excel_price_matrix"` |
| `action` | `"guard_cleanup_failed"` | `"guard_cleanup_ownership_mismatch"` |
| `after.error` | Error message | `null` |
| `after.guardId` | ✅ | ✅ |
| `after.qualificationId` | ✅ | ✅ |
| `after.rtoId` | ✅ | ✅ |

**Sensitive data:** No tokens, passwords, or secrets are logged in audit records. The `ownerToken` is **not** included in audit `after` objects (only `guardId`, `qualificationId`, `rtoId`).

**API responses:** No internal lock details, owner tokens, or guard information exposed to API clients.

### 5.3 Gaps

1. **No dedicated admin endpoint** for listing or searching guard documents. Operators must query MongoDB directly.
2. **No audit record for successful guard cleanup** — only failures are audited. Successful cleanup leaves no trace beyond guard removal.
3. **No audit record for manual guard deletion** — operators must maintain external change logs.

---

## 6. Deployment Documentation Comparison

### 6.1 Documented vs. Actual Architecture

| Aspect | DEPLOYMENT.md claims | Actual implementation | Drift |
|--------|---------------------|----------------------|-------|
| Backend framework | Express 5 + TS + Mongoose | Next.js App Router API routes | **Major** |
| Server scripts | `server/src/server.ts`, `server/src/worker.ts` | Do not exist | **Major** |
| Queue | BullMQ + ioredis | Not provisioned (`settings.tsx:7`) | **Major** |
| Start command | `npm run server:start` | `npm run start` (Next.js) | **Major** |
| Build command | `npm run server:build` | `npm run build` (Next.js) | **Major** |
| Services | API + Worker + Frontend + Redis | Single Next.js web service | **Major** |
| Redis | `REDIS_URL` in server env | Not wired to application | **Major** |
| Worker | Separate background worker | None | **Major** |
| Port | 4000 | 3000 | Minor |
| Worker script | `node server/dist/worker.js` | Does not exist | **Major** |

### 6.2 Specific Documentation Issues

1. **DEPLOYMENT.md line 11:** References `server/src/server.ts` with BullMQ worker — file does not exist.
2. **DEPLOYMENT.md line 12:** References `server/src/worker.ts` — file does not exist.
3. **DEPLOYMENT.md line 15:** References `server/.env.example` — directory does not exist.
4. **DEPLOYMENT.md lines 106-109:** Documents API and Worker as separate services with `server:build`/`server:start` — not applicable.
5. **DEPLOYMENT.md line 119:** References `npm run server:seed` — script does not exist (actual: `seed:admin`).
6. **DEPLOYMENT.md line 131:** References `npm run server:smoke` — script does not exist.
7. **DEPLOYMENT.md line 25:** Lists Docker host (VPS, Railway) as option — `docker-compose.yml` only includes Redis, no application container.
8. **DEPLOYMENT.md line 32:** Claims "Docker deploy: Containerised" — no application Dockerfile exists.
9. **DEPLOYMENT.md line 170:** Lists `render.yaml` as creating "API, worker, frontend, Redis" — `render.yaml` only creates a single Next.js web service and a Redis database (not wired to app).

### 6.3 render.yaml Accuracy

`render.yaml` is **accurate** for the current implementation — it defines a single Next.js web service (`npm run start` on port 3000) with MongoDB Atlas and a provisioned (but unwired) Redis database.

### 6.4 Actual Production Start Command

`npm run start` → `next start` (Next.js production server on port 3000)

### 6.5 Timeout and Process Lifecycle

No `maxDuration` configured in `next.config.ts`. No explicit request timeout in code. Render's default web service timeout applies (typically 100s for standard plan). A long-running Price Matrix import could be interrupted by platform timeout.

---

## 7. Risk Assessment

| Risk | Severity | Evidence | Recommended Operational Mitigation |
|------|----------|----------|-----------------------------------|
| Crash-created orphan guard | High | Process crash between guard insert and cleanup leaves permanent guard; no TTL, no lease, no automated recovery | Document manual recovery procedure; operator must confirm no active import before deleting guard via `deleteOne({ _id, type: "price_matrix_lock" })` |
| Active import mistakenly treated as orphan | Critical | No process registry, no heartbeat, no lease; `createdAt` alone insufficient to prove orphan status | **Never delete based on age alone.** Require external operator confirmation that no import is in progress before manual deletion |
| Concurrent import during recovery | Medium | No maintenance mode, no import-disable feature exists | Schedule maintenance window; communicate to operators to avoid Price Matrix imports during recovery |
| Stale-owner supplier-route write | Medium | OwnerToken protects cleanup ownership only; no fencing token; stale owner could insert routes after losing lock | Document as known limitation; consider fencing tokens or serialized execution for future enhancement |
| Cleanup failure | High | `deleteOne` failure logged to stderr + audit record; import result preserved | Monitor stderr logs for `[price_matrix_lock] guard cleanup failed`; audit records searchable by `action: "guard_cleanup_failed"` |
| Documentation drift | High | DEPLOYMENT.md references Express, BullMQ, `server/` directory that do not exist | Correct documentation to match actual Next.js deployment before production use |

---

## 8. Classification Summary

| Item | Classification | Basis |
|------|---------------|-------|
| Guard acquisition safety | Verified | MongoDB `_id` unique index provides atomic mutual exclusion; tested with concurrent imports |
| Owner-verified cleanup | Verified | `deleteOne({ _id, ownerToken })` with `deletedCount` check; tested |
| Cleanup failure observability | Verified | Stderr logging + audit records; tested |
| Import history filtering | Verified | `type: { $ne: "price_matrix_lock" }` excludes guards; tested |
| Manual recovery safety | **Not verifiable** | No process registry, no heartbeat, no lease; cannot prove import has stopped |
| Automated orphan recovery | **Not feasible** | Same limitation as above; would require lease/heartbeat infrastructure |
| Deployment documentation accuracy | **Drifted** | DEPLOYMENT.md describes Express/BullMQ architecture not present in codebase |

---

## 9. Report File Path

**Saved to:** `docs/phase-7-step-14-operational-recovery-audit.md`

This file was created as the final deliverable. No project convention was found that would make this inappropriate — the `docs/` directory contains `setup/`, `development/`, `architecture/`, and `phase-0-rpl-security/` subdirectories, and a `phase-7-step-14` report fits within this structure.

---

## 10. Recommended Next Steps

1. **Correct deployment documentation** — Update `DEPLOYMENT.md` to describe the actual Next.js single-service deployment on Render, removing references to Express, BullMQ, `server/` directory, and non-existent scripts.

2. **Document manual recovery procedure** — Create an operator runbook (this report serves as the basis) for orphaned guard recovery, emphasizing that age-based deletion is unsafe.

3. **Add stderr log monitoring** — Monitor production logs for `[price_matrix_lock] guard cleanup failed` and `[price_matrix_lock] guard cleanup deletedCount=0` to detect orphaned guards.

4. **Consider fencing tokens** — For future enhancement, add a monotonically increasing fencing token to supplier-route inserts to prevent stale-owner writes after lock expiry.

5. **Consider import job records** — For future enhancement, create normal `excel_imports` job records for Price Matrix imports to enable cross-referencing active imports during recovery.

---

## Confirmations

- **No source code modified** — read-only audit only
- **No production data accessed** — source code and documentation inspection only
- **No Git history modified** — branch `rony-dev`, HEAD `ed04371`, working tree unchanged
- **No deployment modified** — no commits, pushes, or deployments
- **No MongoDB commands executed** — all database operations described as documentation examples only
- **No credentials exposed** — no connection strings, secrets, or personal information in this report
