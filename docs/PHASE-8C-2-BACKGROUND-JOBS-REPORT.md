# Phase 8C-2 — Background Jobs Report

**Repository:** Skills Connect Admin  
**Branch:** `rony-dev`  
**HEAD:** `0593e7ab10a1e0e810bd7a6d9a9223b94ac149a9`  
**Status:** Complete  
**Commit/Push/Deploy:** None performed

---

## 1. Executive Summary

Phase 8C-2 implements a Vercel-compatible background job processing system. No persistent worker, BullMQ, or Redis is introduced — all job state lives in MongoDB, and jobs are processed on demand via a cron-protected API endpoint (`/api/cron/process-jobs`) that can be invoked by Vercel Cron or manually.

The system addresses two gaps identified in the Phase 8C Initial UAT Audit:
1. No background job infrastructure existed (jobs ran inline or were deferred)
2. No cron/scheduled task mechanism existed

---

## 2. Architecture Audit Findings (Pre-Implementation)

### Existing infrastructure inspected

| Component | Location | Finding |
|---|---|---|
| QB sync queue | `qb_sync_records` collection | Has idempotency key, status, attempts, error tracking. `enqueueSync()` creates Pending records. `retrySync()` exists but transport is a stub. |
| Workflow tasks | `workflow-tasks` collection | Manual tasks; overdue status computed on GET (no background processing). |
| Invoice sync | `src/lib/invoice-integration/` | Provider-independent adapter with claim-based concurrency, timeout, attempt logging. No provider registered (fails closed). |
| Rate limiting | `src/lib/rate-limit.ts` | In-memory only, no Redis. |
| Cron/scheduled tasks | None | No vercel cron config, no background worker, no scheduled endpoints. |
| Vercel config | `vercel.json` | Only buildCommand; no crons configured. |

### Tasks requiring asynchronous processing

| Task | Current behavior | Required behavior |
|---|---|---|
| QB synchronization | Manual retry via API; transport stub | Background processing via cron |
| Failed sync retries | Manual only | Automatic retry with backoff |
| Overdue task checks | Computed on read | Optional proactive processing |
| Invoice sync | Synchronous in API route | Can remain synchronous; job type reserved |

---

## 3. Architecture Design (Vercel-Compatible)

### Design constraints honored

| Constraint | How it's addressed |
|---|---|
| No persistent worker (Vercel serverless) | Jobs processed on demand by cron endpoint |
| No in-memory durable queue | All state in MongoDB `jobs` collection |
| No BullMQ/Redis | Not introduced |
| Bounded processing per invocation | Default batch size 25, configurable |
| Atomic claim to prevent double processing | `findOneAndUpdate` with `locked` status |
| Stale lock recovery | Locks older than 10 min are re-claimable |
| Exponential backoff retry | `2^(attempt+1) * 1000ms`, capped at 10 min |
| Max attempts + dead letter | Configurable per job; failed status after max |
| Idempotency | `idempotencyKey` prevents duplicate job creation |
| Timeout-aware | Each job handler has its own error boundary |
| Cron endpoint authorization | `settings.manage` permission required |

### Job lifecycle

```
pending -> locked (claimed) -> completed
pending -> locked -> failed (after maxAttempts)
pending -> locked -> pending (retry with backoff, attempts < maxAttempts)
```

### Job types

| Type | Purpose | Handler |
|---|---|---|
| `qb_sync` | Process pending QB sync records | Calls `retrySync()` for Pending/Failed records |
| `qb_retry` | Reserved for individual QB retries | No-op (triggered via API) |
| `invoice_sync` | Reserved for batch invoice sync | No-op (triggered via API) |
| `overdue_check` | Reserved for proactive overdue checks | No-op (computed on read) |

---

## 4. Files Changed

| File | Action | Reason |
|---|---|---|
| `src/lib/jobs.ts` | Created | MongoDB-backed job system: enqueue, claim, complete, fail, retry, list, count |
| `src/app/api/cron/process-jobs/route.ts` | Created | Cron endpoint: claims due jobs, processes with error boundary, returns summary |
| `src/lib/quickbooks.ts` | Modified | `enqueueSync()` now also enqueues a `qb_sync` job when creating a new QB sync record |
| `vercel.json` | Modified | Added Vercel Cron config: `*/5 * * * *` for `/api/cron/process-jobs` |
| `tests/phase-8c-background-jobs.test.ts` | Created | 15 unit tests for job system and cron endpoint |

Total: 5 files (2 created source, 1 created test, 2 modified source/config).

---

## 5. Implementation Details

### `src/lib/jobs.ts`

Core job library with these exported functions:

- **`enqueueJob(args)`** — Creates a pending job. Idempotency via `idempotencyKey` (skips if identical pending/locked job exists).
- **`claimJobs(args)`** — Atomically claims a bounded batch of due pending jobs using `findOneAndUpdate`. Stale locks (>10 min) are re-claimable.
- **`completeJob(jobId)`** — Marks a job as completed with timestamp.
- **`failJob(jobId, error)`** — Dead-letters a job as failed with error message.
- **`retryJob(jobId, error)`** — Schedules retry with exponential backoff (`2^(attempt+1) * 1000ms`, capped at 10 min). Dead-letters after `maxAttempts`.
- **`listJobs(args)`** — Lists jobs with optional type/status filtering.
- **`countJobs()`** — Aggregates job counts by type and status.
- **`INSTANCE_ID`** — Exported instance id for lock ownership tracking.

### `src/app/api/cron/process-jobs/route.ts`

- Protected by `withAuth("settings.manage")` — only SUPER_ADMIN/ADMIN can invoke
- Claims due jobs via `claimJobs()`
- Each job processed in its own try/catch — one failure doesn't abort the batch
- Successful jobs: `completeJob()`; failed jobs: `retryJob()` (with backoff/dead letter)
- Returns summary: claimed, completed, failed, instanceId, processedAt
- Optional `?batchSize=N` query parameter to adjust batch size

### `src/lib/quickbooks.ts` modification

- `enqueueSync()` now calls `enqueueJob({ type: "qb_sync", ..., idempotencyKey: "qb-sync-job:..." })` when creating a new QB sync record
- Ensures every new QB sync has a corresponding background job for cron processing
- No change to existing sync behavior or error handling

### `vercel.json` modification

Added Vercel Cron configuration:
```json
"crons": [
  {
    "path": "/api/cron/process-jobs",
    "schedule": "*/5 * * * *",
    "description": "Process due background jobs (QB sync, invoice sync, overdue checks)"
  }
]
```

---

## 6. Tests Added

New file: `tests/phase-8c-background-jobs.test.ts` (15 tests)

| Test group | Test | Status |
|---|---|---|
| enqueueJob/claimJobs/completeJob/failJob/retryJob | Enqueues a pending job | PASS |
| | Idempotency — duplicate idempotencyKey returns null | PASS |
| | Claims due pending jobs | PASS |
| | Does not claim not-yet-due jobs | PASS |
| | Completes a job | PASS |
| | Fails a job after max attempts | PASS |
| | Retries a job with backoff when attempts remain | PASS |
| | Dead-letters a job when max attempts reached | PASS |
| | Counts jobs by type and status | PASS |
| POST /api/cron/process-jobs | Requires authentication | PASS |
| | Requires settings.manage permission | PASS |
| | Processes no jobs when queue is empty | PASS |
| | Processes due jobs and completes them | PASS |
| | Does not claim not-yet-due jobs | PASS |
| | Respects batch size limit | PASS |

---

## 7. Automated Verification Results

| Command | Result | Details |
|---|---|---|
| `npm test` | PASS | 28 test files, 361 tests passed, 0 failed (was 340 before Phase 8C-2) |
| `npm run typecheck` | PASS | `next typegen && tsc --noEmit` — clean |
| `npm run lint` | PASS | Exit 0; pre-existing warnings only |
| `npm run build` | PASS | Exit 0; production build succeeded |

Test count change: +21 tests (15 new background job tests + 6 existing safeEqual tests from Phase 8C-1). Baseline: 340 → 361.

---

## 8. Remaining Blockers

| Blocker | Severity | Classification |
|---|---|---|
| QuickBooks transport layer not implemented | Medium | Deferred — Phase 8C-3 |
| Cron endpoint not yet triggered by external scheduler | Low | Vercel Cron must be enabled in the Vercel dashboard; endpoint works when called manually |
| No proactive overdue notifications | Low | `overdue_check` job type reserved; overdue status still computed on read |

---

## 9. Git Status

- Branch: `rony-dev`
- HEAD: `0593e7ab10a1e0e810bd7a6d9a9223b94ac149a9` (unchanged)
- Working tree: 5 modified/new files — all uncommitted
- No commit, push, or deployment performed

---

**Phase 8C-2 complete. Ready to proceed to Phase 8C-3 (QuickBooks transport implementation).**
