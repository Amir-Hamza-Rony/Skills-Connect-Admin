# Phase 7 Step 17 — Atomic Coordination and Fencing Architecture Correction

**Repository:** Skills Connect Admin
**Branch:** `rony-dev`
**HEAD:** `ed043712fe1bb34793be97e1f5c53b3c76161f1c`
**Audit type:** Read-only architecture investigation and design correction
**Date:** 2026-11-23

---

## 1. Executive Summary

This report corrects and finalizes the architecture identified in Step 16. It addresses six critical issues:

1. **Maintenance admission race** — A maintenance flag check followed by guard insertion is not atomic. No single `insertOne` can atomically check another document's maintenance state.
2. **Guard read inside transaction doesn't prevent concurrent guard deletion** — Reading a guard document inside a transaction and then inserting a supplier route does not stop another transaction from deleting the guard between the read and the write.
3. **Random ownerToken is not a fencing token** — A UUID provides uniqueness, not ordering. It cannot prove which of two concurrent owners is "newer."
4. **Fencing must be validated atomically with the protected write** — The fencing check and the `insertOne` on `supplier-routes` must occur in the same atomic operation or transaction.
5. **Processing lifecycle record cannot prove active import** — Without heartbeat/lease, a `processing` status is indistinguishable from a crashed import.
6. **Transaction rollback doesn't solve all recovery problems** — Rollback undoes database writes but cannot undo application-level effects or resurrect a crashed process.

**Core finding:** No design within the current constraints (single Next.js web service, no Redis wiring, no background worker, no new collections) can GUARANTEE:
- Stale-writer protection after guard loss without fencing on the route insert itself
- Automatic crash recovery without heartbeat/lease
- Zero-race maintenance admission without shared coordination

The **minimum architectural change required** for full safety is either:
- A fencing token field validated atomically with each `supplier-routes.insertOne`, OR
- A dedicated worker/queue that serializes imports, OR
- Redis-based distributed locking

Within existing constraints, the safest practical design is **shared coordination document + MongoDB transactions + owner-verified guard + lifecycle records + manual recovery with operator confirmation**.

---

## 2. Corrections to Step 16

| Step 16 Claim | Correction |
|---------------|------------|
| "Approach C (Maintenance Flag + Lifecycle Records + Fencing) recommended" | Corrected: Approach C alone is insufficient. Fencing on the route insert is required for stale-writer protection. Without it, a stale owner can still insert routes. |
| "Transaction-based admission provides atomicity" | Corrected: Transactions provide atomicity for writes within the transaction, but cannot prevent a concurrent transaction from deleting a guard document that this transaction already read. |
| "Lifecycle records enable active-import detection" | Corrected: Lifecycle records cannot distinguish active from crashed imports without heartbeat/lease. A `processing` record may belong to a crashed process. |
| "OwnerToken protects cleanup ownership only" | Confirmed: This remains correct. OwnerToken does not prevent stale-writer operations on `supplier-routes`. |

---

## 3. Atomic Admission Proof

### 3.1 The Fundamental Constraint

MongoDB `insertOne` is atomic only with respect to the document being inserted and its collection's unique indexes. It cannot atomically check the state of a **different** document. Therefore:

- `db.excel_imports.insertOne({ _id: "price_matrix_lock:Q:R", ... })` cannot condition on whether a maintenance flag document exists.
- `db.excel_imports.updateOne({ _id: "maintenance", $set: { enabled: true } })` cannot atomically prevent concurrent guard inserts.

### 3.2 Shared Coordination Document Protocol

The only way to atomically coordinate maintenance activation and import admission within existing constraints is a **shared coordination document** in the `excel_imports` collection:

```json
{
  "_id": "price_matrix_coordination",
  "type": "price_matrix_coordination",
  "maintenanceEnabled": false,
  "maintenanceEnabledAt": null,
  "maintenanceEnabledBy": null,
  "activeImportCount": 0,
  "activeImports": {
    "<qualOid>:<rtoOid>": "<ownerToken>"
  },
  "version": 1,
  "updatedAt": "<ISO>"
}
```

#### Admission Protocol (inside a transaction)

1. `session.startTransaction()`
2. Read coordination doc: `findOne({ _id: "price_matrix_coordination" })` with session
3. If `maintenanceEnabled === true` → abort transaction, reject import
4. `activeImportCount++` and add entry to `activeImports` map
5. `updateOne({ _id: "price_matrix_coordination", version: currentVersion }, { $inc: { version: 1 }, $set: { activeImportCount, activeImports, updatedAt } })` with session
   - If `version` mismatch → another transaction modified it → abort, retry
6. Insert guard document: `insertOne({ _id: "price_matrix_lock:Q:R", ... })` with session
7. Insert lifecycle record: `insertOne({ type: "price_matrix_import", status: "processing", ... })` with session
8. `session.commitTransaction()`

#### Maintenance Activation Protocol (inside a transaction)

1. `session.startTransaction()`
2. Read coordination doc with session
3. If `maintenanceEnabled === true` → already active, abort
4. `updateOne({ _id: "price_matrix_coordination", version: currentVersion }, { $set: { maintenanceEnabled: true, maintenanceEnabledAt: now, maintenanceEnabledBy: actorId, version: currentVersion + 1 }, $inc: { version: 1 } })` with session
   - If `version` mismatch → another transaction modified it → abort, retry
5. `session.commitTransaction()`

#### Proof That New Import Cannot Be Admitted After Maintenance Activation Commits

| Time | Maintenance Transaction | Import Transaction |
|------|------------------------|-------------------|
| T1 | Read coordination doc (version=5, maintenanceEnabled=false) | — |
| T2 | — | Read coordination doc (version=5, maintenanceEnabled=false) |
| T3 | `updateOne` sets maintenanceEnabled=true, version=6. Commits. | — |
| T4 | — | `updateOne` with version=5 fails (version mismatch). Aborts. |
| T5 | — | Import rejected: maintenance active. |

**The `version` field provides optimistic concurrency control.** The maintenance transaction commits first, incrementing the version. The import transaction's `updateOne` with the stale version fails, preventing admission.

#### Limitation

If the import transaction reads the coordination doc at T2 (before maintenance commits at T3), and then attempts its `updateOne` at T4, the version mismatch causes abort. However, if the import reads at T2 and attempts its `updateOne` **before** T3 (between T2 and T3), both could succeed if the import's `updateOne` commits first. This is the inherent race of optimistic concurrency — the last writer wins. To fully prevent this, maintenance activation and import admission must be **serialized** (only one can hold the coordination lock at a time), which requires either:
- A separate lock document acquired before either operation, or
- All operations funneled through a single worker/queue

### 3.3 Multi-Instance Behavior

MongoDB's `updateOne` with version check is atomic across all instances connected to the same replica set. The coordination document approach works across multiple Render instances because MongoDB is the shared source of truth.

### 3.4 Crash Behavior

- If import transaction crashes after step 4 (increment activeImportCount) but before step 8 (commit): The transaction rolls back. `activeImportCount` is not incremented. No guard is created. Clean state.
- If maintenance transaction crashes before commit: Maintenance is not activated. Clean state.
- If import transaction commits but process crashes before guard cleanup: Guard persists as orphan. Lifecycle record exists with `status: "processing"`. Cannot distinguish from active import without heartbeat.

---

## 4. Import Lifecycle Design

### 4.1 Lifecycle Record Schema

Stored in existing `excel_imports` collection:

```json
{
  "_id": "<ObjectId>",
  "type": "price_matrix_import",
  "qualificationId": "<qualOid string>",
  "rtoId": "<rtoOid string>",
  "status": "starting" | "processing" | "completed" | "failed" | "interrupted" | "recovery_required",
  "ownerToken": "<uuid-v4>",
  "guardId": "price_matrix_lock:<qualOid>:<rtoOid>",
  "startedBy": "<userId>",
  "startedAt": "<ISO>",
  "completedAt": "<ISO | null>",
  "rowsImported": <number>,
  "rowsPending": <number>,
  "errors": <array>,
  "version": 1,
  "updatedAt": "<ISO>"
}
```

### 4.2 State Transitions

| From → To | Trigger | Atomic Operation |
|-----------|---------|-----------------|
| (none) → `starting` | Import begins | `insertOne` lifecycle record inside transaction |
| `starting` → `processing` | Guard acquired successfully | `updateOne({ _id, version }, { $set: { status: "processing", version: version + 1 } })` inside transaction |
| `processing` → `completed` | All routes inserted | `updateOne(...)` inside transaction or after commit |
| `processing` → `failed` | Validation or DB error | `updateOne(...)` |
| `processing` → `interrupted` | Recovery operation determines import cannot continue | Manual `updateOne(...)` by operator |
| `interrupted` → `recovery_required` | Guard still exists after interruption | Manual `updateOne(...)` |
| `recovery_required` → `completed` | Recovery successful, guard removed | `updateOne(...)` |

### 4.3 Why `processing` Cannot Prove Active Import

A `processing` lifecycle record can exist because:
1. An import is actively running (safe to wait)
2. An import crashed after creating the record but before any route insert (orphan — safe to recover)
3. An import crashed after inserting some routes but before completion (partial — needs manual review)
4. An import created the record but the process died before the first route insert (orphan — safe to recover)

**Without heartbeat/lease, the database cannot distinguish cases 1 from 2-4.** An operator must use external evidence (application logs, user confirmation) to determine if an import is actually running.

---

## 5. True Fencing Design

### 5.1 What Fencing Requires

A fencing token must be:
1. **Monotonically increasing** — each new owner gets a higher token than the previous
2. **Validated atomically with the protected write** — the fencing check and the `insertOne` must be in the same atomic operation
3. **Revoked on ownership change** — when a new owner takes over, the old owner's token is invalidated

### 5.2 Why Random UUID Is Not a Fencing Token

A `randomUUID()` provides uniqueness but not ordering. Two concurrent owners cannot determine which is "newer." A UUID cannot be compared to decide which write should be rejected.

### 5.3 Fencing Protocol Options

#### Option A: Per-Combination Fencing Counter on Guard Document

```json
{
  "_id": "price_matrix_lock:<qualOid>:<rtoOid>",
  "type": "price_matrix_lock",
  "fencingToken": 5,
  "ownerToken": "<uuid-v4>",
  ...
}
```

**Protocol:**
1. Import A acquires guard with `fencingToken: 5`, `ownerToken: "uuid-A"`
2. Import B waits, then acquires guard after A releases it with `fencingToken: 6`, `ownerToken: "uuid-B"`
3. Import A (stale) attempts route insert with `fencingToken: 5`
4. Route insert validates: `fencingToken` on guard is now 6, but A's token is 5 → reject

**Atomic validation:**
```typescript
// Inside transaction with session
const guard = await guardColl.findOne({ _id: guardId }).session(session);
if (!guard || guard.fencingToken !== expectedToken) {
  throw new Error("Stale owner: fence token mismatch");
}
await routeColl.insertOne({ ..., fencingToken: expectedToken }, { session });
```

**Limitation:** Between reading the guard (step 3) and inserting the route (step 4), another transaction could delete the guard and create a new one with a higher fencing token. The stale owner's route insert would still succeed because the route insert doesn't reference the guard document. **Cross-collection atomicity is not guaranteed.**

#### Option B: Fencing Token Stored on Supplier-Route Insert (Conditional)

Not directly supported by MongoDB. `insertOne` cannot condition on a value in another collection.

#### Option C: Serialized Execution (Single Worker)

Only one import worker processes Price Matrix imports at a time. No concurrent guard acquisition possible. No stale-writer problem.

**Infrastructure required:** Background worker + queue (not currently available).

### 5.4 Remaining Race Conditions Even With Fencing

| Race | Description | Preventable? |
|------|-------------|--------------|
| Guard deleted between read and route insert | Transaction A reads guard (valid), Transaction B deletes guard and creates new one with higher fencing, Transaction A inserts route with stale fencing | **No** — cross-collection operation |
| Two transactions read same guard, both insert routes | Both see same fencing token, both insert | **Partially** — guard deletion prevents second from acquiring, but if both acquired before either deleted... |
| Process crashes after route insert, before fencing update | Route exists but fencing not advanced | **No** — requires manual reconciliation |

**Conclusion:** True fencing that prevents ALL stale-writer writes requires either:
- Cross-collection conditional inserts (not supported by MongoDB)
- A fencing token stored ON the supplier-route document and validated on subsequent inserts (complex, requires schema changes)
- Serialized execution via dedicated worker (infrastructure not available)

Within existing constraints, fencing provides **best-effort** protection, not guarantees.

---

## 6. Transaction Validation

### 6.1 Evidence from Codebase

**`src/lib/db.ts:26-28`:**
```typescript
export async function getClient(): Promise<MongoClient> {
  return ensureClient();
}
```
`getClient()` returns a cached `MongoClient`, which supports `startSession()` and `withTransaction()`.

**`src/app/api/excel/import/route.ts:238-297`:**
Proven working transaction pattern with `session.withTransaction()` and `{ session }` on all write operations.

**`src/lib/db.ts:11-17`:** Single `MongoClient` cached globally, connected once via `ensureClient()`.

### 6.2 What Transactions Can and Cannot Do

| Can Do | Cannot Do |
|--------|-----------|
| Atomically insert guard + lifecycle record + route | Prevent another transaction from deleting a guard this transaction already read |
| Roll back all writes on crash within transaction | Prevent application-level side effects (logs sent, external APIs called) |
| Provide snapshot isolation for reads within transaction | Serialize access across transactions (last writer wins on version conflicts) |
| Ensure `updateOne` with version check is atomic | Guarantee crash recovery without manual intervention |

### 6.3 Required Shared-Document Writes for Coordination

For atomic admission + maintenance coordination, ALL operations must write to the **same coordination document**:

1. Maintenance activation: `updateOne({ _id: "price_matrix_coordination" }, { $set: { maintenanceEnabled: true, ... } })`
2. Import admission: `updateOne({ _id: "price_matrix_coordination" }, { $inc: { activeImportCount: 1 } })`
3. Guard release: `updateOne({ _id: "price_matrix_coordination" }, { $inc: { activeImportCount: -1 } })`

If any operation writes to a different document (e.g., guard insert on `excel_imports` with `_id: "price_matrix_lock:Q:R"`), that write is **not** part of the coordination document's atomicity. MongoDB transactions provide atomicity across multiple documents within the same transaction, but **only if all operations are within the same `withTransaction()` block**.

### 6.4 Write-Conflict Behavior

When two transactions attempt `updateOne` on the same coordination document:
- MongoDB uses optimistic concurrency control at the document level
- The first transaction to commit wins
- The second transaction receives a write conflict error and must retry
- Retry logic must be implemented in application code

### 6.5 Transaction Duration and Contention

- Transactions hold document locks for the duration of the `withTransaction()` block
- A long-running import (many rows) holds locks on `excel_imports` (coordination doc), `supplier-routes`, and `audit_logs` for the entire batch
- Concurrent imports on different RTO+Qualification combinations are not blocked (different guard documents)
- Concurrent imports on the same combination serialize at guard insert (unique `_id`)

---

## 7. Crash Recovery Model

### 7.1 Crash at Each Lifecycle Stage

| Stage | Persisted State | Auto-Recovers? | Required Recovery |
|-------|----------------|----------------|-------------------|
| Before guard acquisition | None | N/A | None |
| After guard acquisition, before lifecycle record | Guard document | No | Manual guard deletion + operator confirmation |
| After lifecycle `starting` | Guard + lifecycle `starting` | No | Manual cleanup of both |
| During route insertion | Guard + lifecycle `processing` + partial routes | No | Manual route review; mark import `failed`/`interrupted` |
| After route insert, before completion | Routes inserted + no lifecycle completion | No | Manual reconciliation |
| After cleanup, before audit | Routes inserted + guard removed | Partial — routes exist | Manual verification |
| During cleanup (deleteOne fails) | Guard persists | No | Manual deletion |

### 7.2 Can Recovery Safely Revoke Ownership?

**No — not automatically.** A recovery operation cannot:
- Prove the original process is dead (no heartbeat/lease)
- Prevent the original process from inserting more routes if it wakes up (no fencing on route insert)
- Distinguish a crashed import from a slow-but-healthy import (no timeout mechanism)

**Recovery must remain manual** with operator confirmation:
1. Operator confirms no import process is running (external observation)
2. Operator verifies guard document details (qualificationId, rtoId, ownerToken)
3. Operator deletes guard: `deleteOne({ _id, type: "price_matrix_lock" })`
4. Operator marks lifecycle record: `updateOne({ _id }, { $set: { status: "interrupted" } })`
5. Operator writes audit record

### 7.3 Why Automatic Orphan Deletion Is Unsafe

Without fencing on route inserts, deleting an orphan guard and allowing a new import could result in:
1. Old process (still running) inserts route with stale data
2. New process (after guard deletion) inserts route with new data
3. Two overlapping active routes for the same RTO + Qualification

This violates the business rule of one sourcing agent per RTO + Qualification combination.

---

## 8. Final Architecture Proposal

### 8.1 Recommended: Shared Coordination + Transactions + Owner-Verified Guard + Lifecycle Records + Manual Recovery

This is the safest architecture achievable within existing constraints (no new collections, no Redis wiring, no background worker).

### 8.2 Coordination Document Schema

```json
{
  "_id": "price_matrix_coordination",
  "type": "price_matrix_coordination",
  "maintenanceEnabled": false,
  "maintenanceEnabledAt": null,
  "maintenanceEnabledBy": null,
  "activeImportCount": 0,
  "activeImports": {},
  "version": 1,
  "updatedAt": "<ISO>"
}
```

### 8.3 Guard Document Schema

```json
{
  "_id": "price_matrix_lock:<qualOid>:<rtoOid>",
  "type": "price_matrix_lock",
  "qualificationId": "<qualOid string>",
  "rtoId": "<rtoOid string>",
  "ownerToken": "<uuid-v4>",
  "fencingToken": <integer>,
  "createdAt": "<ISO>",
  "updatedAt": "<ISO>"
}
```

### 8.4 Lifecycle Record Schema

```json
{
  "_id": "<ObjectId>",
  "type": "price_matrix_import",
  "qualificationId": "<qualOid string>",
  "rtoId": "<rtoOid string>",
  "status": "starting" | "processing" | "completed" | "failed" | "interrupted" | "recovery_required",
  "ownerToken": "<uuid-v4>",
  "guardId": "price_matrix_lock:<qualOid>:<rtoOid>",
  "startedBy": "<userId>",
  "startedAt": "<ISO>",
  "completedAt": "<ISO | null>",
  "rowsImported": <number>,
  "rowsPending": <number>,
  "errors": <array>,
  "version": 1,
  "updatedAt": "<ISO>"
}
```

### 8.5 Operation Sequence (Import)

```
1. session = client.startSession()
2. session.withTransaction(async () => {
3.   // Step 1: Check maintenance (atomic with coordination doc)
4.   coord = excel_imports.findOne({ _id: "price_matrix_coordination" }, { session })
5.   if coord.maintenanceEnabled → throw "maintenance active"
6.
7.   // Step 2: Register active import
8.   coord.activeImportCount++
9.   coord.activeImports[`${qualOid}:${rtoOid}`] = ownerToken
10.  excel_imports.updateOne({ _id: "price_matrix_coordination", version: coord.version },
11.                          { $set: { activeImportCount, activeImports, version: coord.version + 1, updatedAt: now } }, { session })
12.  // If version mismatch → abort and retry
13.
14.  // Step 3: Acquire guard
15.  excel_imports.insertOne({ _id: guardId, type: "price_matrix_lock", ..., ownerToken, fencingToken: coord.fencingToken + 1 }, { session })
16.  // If 11000 → another import holds guard → abort
17.
18.  // Step 4: Create lifecycle record
19.  excel_imports.insertOne({ _id: lifecycleId, type: "price_matrix_import", status: "starting", ownerToken, guardId, ... }, { session })
20.
21.  // Step 5: Transition to processing
22.  excel_imports.updateOne({ _id: lifecycleId, version: 1 }, { $set: { status: "processing", version: 2, updatedAt: now } }, { session })
23.
24.  // Step 6: Insert route (with owner validation inside transaction)
25.  guard = excel_imports.findOne({ _id: guardId, ownerToken }, { session })
26.  if !guard → throw "stale owner: guard lost"
27.  supplier-routes.insertOne({ ..., fencingToken: guard.fencingToken, ... }, { session })
28.
29.  // Step 7: Cleanup guard
30.  excel_imports.deleteOne({ _id: guardId, ownerToken }, { session })
31.
32.  // Step 8: Mark lifecycle complete
33.  excel_imports.updateOne({ _id: lifecycleId }, { $set: { status: "completed", completedAt: now, ... } }, { session })
34.
35.  // Step 9: Decrement active import count
36.  excel_imports.updateOne({ _id: "price_matrix_coordination", ... }, { $inc: { activeImportCount: -1 }, $unset: { activeImports: {...} } }, { session })
37.
38.  await session.commitTransaction()
39. })
```

### 8.6 Operation Sequence (Maintenance Activation)

```
1. session = client.startSession()
2. session.withTransaction(async () => {
3.   coord = excel_imports.findOne({ _id: "price_matrix_coordination" }, { session })
4.   if coord.maintenanceEnabled → throw "already active"
5.   excel_imports.updateOne({ _id: "price_matrix_coordination", version: coord.version },
6.                           { $set: { maintenanceEnabled: true, maintenanceEnabledAt: now, maintenanceEnabledBy: actorId, version: coord.version + 1, updatedAt: now } }, { session })
7.   await session.commitTransaction()
8. })
```

### 8.7 Recovery Sequence

```
1. Operator confirms no import process running (external observation)
2. Operator identifies guard: excel_imports.findOne({ _id: "price_matrix_lock:Q:R", type: "price_matrix_lock" })
3. Operator verifies qualificationId, rtoId match intended target
4. Operator deletes guard: excel_imports.deleteOne({ _id: guardId, type: "price_matrix_lock" })
5. Operator marks lifecycle: excel_imports.updateOne({ _id: lifecycleId }, { $set: { status: "interrupted", updatedAt: now } })
6. Operator writes audit: writeAudit({ action: "guard_manual_recovery", ... })
7. Operator disables maintenance (if safe)
```

### 8.8 Transaction Boundaries

| Operation | Inside Transaction? | Reason |
|-----------|--------------------|--------|
| Maintenance flag check + active import registration | Yes | Atomic admission control |
| Guard insert | Yes | Part of admission |
| Lifecycle record insert | Yes | Part of admission |
| Guard-to-processing transition | Yes | Atomic status change |
| Route insert | Yes | Write must be coordinated with guard validation |
| Guard delete | Yes | Must be atomic with lifecycle completion |
| Lifecycle completion | Yes | Final state change |
| Active import count decrement | Yes | Clean up coordination state |
| Audit record | No (outside transaction) | Audit failures must not fail import |
| Stderr logging | No | Independent of DB |

---

## 9. Concurrency Test Plan

| Test | Scenario | Expected Result |
|------|----------|-----------------|
| T1 | Two concurrent imports, same RTO+Qual, overlapping dates | Exactly one succeeds; other pended due to guard |
| T2 | Two concurrent imports, same RTO+Qual, non-overlapping dates | Both succeed (guard released between them) |
| T3 | Two concurrent imports, different RTO+Qual | Both succeed |
| T4 | Maintenance enabled, then import attempted | Import rejected |
| T5 | Import in progress, maintenance enabled | Import completes; new imports blocked |
| T6 | Stale owner attempts route insert after guard loss | Route insert rejected (fencing token mismatch) |
| T7 | Process crash after guard acquisition, before cleanup | Guard persists; manual recovery required |
| T8 | Two operators attempt recovery simultaneously | Second gets deletedCount=0; warning logged |
| T9 | Maintenance disabled before recovery complete | New imports can start; recovery incomplete |

**Note:** Test T6 (stale owner) can only be **partially** validated. The fencing check inside the transaction prevents the stale owner's transaction from committing IF the guard was deleted and recreated. However, if the stale owner's transaction reads the guard before deletion and inserts after, the route insert may still succeed. This is a fundamental limitation of cross-collection operations.

---

## 10. Architecture Comparison

| Criterion | A. Maintenance Flag Only | B. + Lifecycle Records | C. + Transactions + Fencing | D. Dedicated Worker |
|-----------|-------------------------|----------------------|---------------------------|-------------------|
| Stale-writer protection | No | No | Partial (best-effort) | Yes (serialized) |
| Crash auto-recovery | No | No | No (manual) | Yes (worker retries) |
| Maintenance admission race | No | No | Partially mitigated | No (serialized) |
| Multi-instance safe | Yes | Yes | Yes | Yes |
| New collections needed | No | No | No | Yes (queue) |
| Infrastructure changes | None | None | None | Redis + worker |
| Complexity | Low | Low | Medium | High |
| Can be implemented now | Yes | Yes | Yes | No |

**Recommendation: Approach C** — Shared coordination document + transactions + owner-verified guard + lifecycle records + fencing token + manual recovery.

**Why not D:** Requires Redis worker + background queue infrastructure not currently available. `settings.tsx:7` confirms Redis is "Blocked — not provisioned."

**Why not A or B:** Insufficient for stale-writer protection and crash recovery.

---

## 11. Remaining Limitations (Honest Assessment)

| Limitation | Severity | Why It Cannot Be Fully Resolved |
|------------|----------|-------------------------------|
| Stale-writer after guard loss | Medium | Cross-collection conditional insert not supported by MongoDB; requires fencing on route insert itself |
| Automatic crash detection | High | No heartbeat/lease/process registry; `processing` status ambiguous |
| Zero-race maintenance admission | Medium | Optimistic concurrency has last-writer-wins race; requires serialization |
| Transaction failure in Price Matrix context | Medium | Previous transaction attempts in this route context failed; cause unknown |
| No automated recovery endpoint | High | Cannot prove import has stopped without heartbeat |

### Minimum Architectural Change for Full Safety

To achieve **guaranteed** stale-writer protection and automatic crash recovery, at least one of the following is required:

1. **Fencing token on supplier-route insert** — Add `fencingToken` field to `supplier-routes` schema; each insert validated against current token atomically
2. **Directed worker/queue** — Single worker processes imports sequentially; no concurrent guard acquisition
3. **Redis-based distributed lock** — Redis `SETNX` with TTL for mutual exclusion; automatic expiry on crash

None of these can be implemented within the current constraints (no new collections, Redis not wired, no background worker).

---

## 12. Report File Path

**Saved to:** `docs/phase-7-step-17-atomic-coordination-architecture.md`

---

## Confirmations

- **No source code modified** — read-only investigation only
- **No production data accessed** — source code and documentation inspection only
- **No Git history modified** — branch `rony-dev`, HEAD `ed04371`, working tree unchanged
- **No deployment modified** — no commits, pushes, or deployments
- **No MongoDB commands executed** — all database operations described as design proposals only
- **No credentials exposed** — no connection strings, secrets, or personal information in this report

**Final recommendation:** Implement Approach C (shared coordination + transactions + owner-verified guard + lifecycle records + fencing token + manual recovery) as the safest achievable architecture. Acknowledge that stale-writer protection and automatic crash recovery cannot be fully guaranteed without infrastructure changes (fencing on route inserts, dedicated worker, or Redis-based locking).
