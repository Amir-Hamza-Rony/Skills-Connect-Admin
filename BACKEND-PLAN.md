# BACKEND PLAN — Skills Connect Admin (Phase B1–B6)

> Companion to `architecture.md` (§1 target) and `workflow.md` (§15 roadmap).
> Status: **B5 code-complete** (see §1.4 and §3b). Front-end shell (Day 1–5, 19 commits on
> `rony-dev`) is complete with an in-memory preview store; this document
> defines how the real backend replaces it.
> Source of truth for requirements: `Skills_Connect_Admin_Software_Developer_Specification.docx`.

## 0. Starting facts (verified)

- Repo root `D:/Office Work/Admin SC`, branch `rony-dev`. Only `src/` existed until B1 —
  backend code now lives in `server/`.
- 3 preview stores, all async + REST-shaped (57 functions total):
  - `src/lib/store.ts` — masters: roles, users, qualifications, RTOs, agents, supplier routes
  - `src/lib/ops-store.ts` — clients, orders (+snapshots/history), documents (+versions/review), tasks
  - `src/lib/fin-store.ts` — invoices, plans, instalments, payments (+allocation), QB sync, audit
- Auth is preview: any password accepted, session id in `localStorage`, no hashing.
- RBAC lives only in `src/lib/permissions.ts` (7 roles × 18 permissions) — **no server enforcement**.
- Missing vs spec §7: `certificates` entity, `communications` (optional), `document_requirements` as a collection.
- Secrets rule: real connection strings/keys go in local `.env` ONLY — never in chat, code, or git.

## 1. Decisions (D1–D4 — CONFIRMED by owner)

| # | Decision | **Confirmed value** | Locked for |
|---|---|---|---|
| D1 | Auth strategy | **JWT access (15 min) + rotating refresh in httpOnly cookie** (spec §3 permits JWT/session) | B2 |
| D2 | Repo layout | **Same repo, `server/` folder, npm workspaces** (atomic commits, shared types) | B1 — done |
| D3 | Mongo for dev | **MongoDB Atlas only** — no local Docker Mongo | B1 |
| D4 | Object storage | **MinIO locally (dev), Cloudflare R2 in production** | B4 |

**D3 consequence:** `docker-compose.yml` has **no mongo service** — the database is remote.
Atlas needs a database name (`skills_connect_admin`) plus an IP allowlist entry per developer
machine. Never open `0.0.0.0/0`.

**D4 consequence:** MinIO, S3 and R2 are all S3-compatible behind one adapter, so the provider
is an **env-only switch** (`STORAGE_PROVIDER` + `S3_*`) with zero code change. Nothing depends
on the choice, which is why B1–B3 were never blocked waiting for it.

Atlas URL is consumed as `MONGODB_URI` from `server/.env` only — never in chat, code, or git.

### B2 — Auth + RBAC · ✅ COMPLETE

| Item | State |
|---|---|
| `users` + `roles` Mongoose models (argon2id, `select:false` on secrets) | done |
| `refresh_tokens` collection (SHA-256 hashed, TTL index, rotation families) | done |
| `audit_logs` collection — append-only, enforced by pre-hooks | done |
| RBAC matrix moved to `server/src/services/permissions.ts` (single source) | done |
| Access JWT (15 min) + opaque rotating refresh in httpOnly cookie | done |
| Refresh rotation + **reuse detection revokes the whole family** | done |
| Logout (family) · logout-all · admin reset-password · account unlock | done |
| `requireAuth` + `requirePermission` on every non-public route | done |
| `tokenVersion` invalidation — deactivation/reset kills live access tokens instantly | done |
| Login rate limit (per IP+email) + per-account lockout | done — **the limiter was a no-op until the audit pass: it counted attempts and set `Retry-After`, then called `next()` anyway. It never returned 429.** |
| `/auth/login` `/auth/refresh` `/auth/logout` `/auth/logout-all` `/auth/me` `/auth/permissions` | done |
| `/users` CRUD + `/users/:id/reset-password` + `/users/:id/unlock` | done |
| `/roles` list + `/roles/:id` permission edit | done |
| Seed script (`npm run server:seed`) — 7 roles + Super Admin, idempotent | done |
| **Frontend cutover**: `src/lib/api.ts` (memory token, single-flight refresh) + real `auth.tsx` | done |
| Frontend `listUsers`/`updateUser`/`listRoles` → real API; `User.roleIds` → `roleNames` | done |

**Deviation from the 17-collection list:** `refresh_tokens` was added. D1 (rotating
refresh with server-side revocation and reuse detection) cannot work statelessly;
the 17 spec §7 collections are business entities and do not include auth session
state. It is infrastructure, documented here rather than silently introduced.

**Verification:** `server:typecheck` clean · `server:test` **68/68** (real MongoDB via
`mongodb-memory-server`, real argon2id, real JWT — no database mocking) ·
`server:build` clean · frontend `npm run build` clean (1958 modules) ·
`npm run server:smoke` **45/45** against the live Atlas database over real HTTP, and
re-runnable.

Live-smoke coverage: health/readiness · wrong password rejected · correct password
accepted · argon2 hash never returned · httpOnly refresh cookie · `/auth/me` ·
refresh rotation issues a new cookie · replaying a used token returns
`REFRESH_REUSE_DETECTED` and revokes the family · logout kills the session ·
Sales user gets **403 on `/users` and `/roles`** while `/auth/me` still returns 200 ·
anonymous `/users` returns 401 (not 403) · deactivation kills live access immediately ·
password reset invalidates a token minted in the *same second* · 7 roles / 18
permissions served from the server.

### B2 design notes worth keeping

- **`tokenVersion`, not timestamps.** A JWT `iat` has one-second resolution, so
  comparing `passwordChangedAt` against it leaves a ~1 s window where a
  reset-in-the-same-second token stays valid. A monotonic counter is exact; a
  regression test covers that specific case.
- **Single-flight refresh on the client.** Refresh tokens rotate, so two parallel
  `POST /auth/refresh` calls would present the same token twice and the server
  would correctly flag the second as replay and revoke the session. `lib/api.ts`
  shares one in-flight promise across concurrent 401s.
- **Permissions are recomputed per request** from database roles rather than read
  from the token, so a matrix change takes effect on the next call instead of at
  the next refresh.
- **Rate limiting moved to Redis in B5.** With more than one replica the
  effective limit would otherwise multiply by the replica count. It still falls
  back to in-process counters when Redis is unreachable.

### B2 defects found and fixed in the audit pass

- **The login rate limiter never refused anything.** It counted, set the headers,
  and called `next()` on both paths, so there was no `429` anywhere in the
  codebase. The only real brake was the per-account lockout, which does not help
  against spraying many unknown addresses. Now returns `429 RATE_LIMITED` with
  `Retry-After`, and the test asserts the refusal rather than merely that nothing
  500'd.
- **An admin unlock did not unlock.** The brute-force counter moved to Redis in
  B5, but `/users/:id/unlock` and `/users/:id/reset-password` only cleared the
  Mongo fields — so the user re-locked on their very next wrong password. Both
  now clear the Redis counter too.
- **`PATCH /roles/:id` documented a self-lockout guard that did not exist.** An
  admin could strip `roles.manage` from their own role and permanently lose the
  ability to edit roles. The guard is implemented, and Super Admin can no longer
  be stripped below full permissions.
- **The audit log's append-only guarantee was narrower than stated.** Query
  pre-hooks cover update/delete, but `save()`, `bulkWrite` and raw collection
  writes bypass them. Acceptable for an internal audit trail; recorded here
  rather than claimed as a structural guarantee.
- **Four routes carry `requireAuth` but no `requirePermission`** — `/auth/me`,
  `/auth/permissions`, `/auth/logout-all` and `/users/directory`. All four are
  deliberately so (a user must be able to read their own permissions, and
  `settings.manage` cannot be required to revoke your own sessions). The plan's
  blanket "on every non-public route" is aspirational, not literal.
- **There is no `DELETE /users/:id`.** Deactivation is used instead, which
  preserves the audit trail — consistent with §4, which lists only GET/POST/PATCH.

### B3 — Masters + Clients/Orders · ✅ COMPLETE

| Item | State |
|---|---|
| Master collections: `agents`, `qualifications` (licensing refs embedded), `rtos`, `supplier_routes` | done |
| **Master REST endpoints** (`/agents`, `/qualifications`, `/rtos`, `/supplier-routes`) + `masters.service.ts` | done — **added in the B1–B5 audit pass; they did not exist when B3 was first marked complete** |
| `clients` collection + `GET/POST/PATCH /clients`, `GET /clients/:id` | done |
| Duplicate-client report (`certain` by email, `possible` by phone) | done |
| `orders` collection with **immutable** `supplierCostSnapshot` | done |
| Snapshot enforced 3 ways: `immutable: true`, pre-update hooks, server reads the route | done |
| Order create refuses when no active route matches (no zero-cost orders) | done |
| Status transition writes history **and** stage task in one transaction | done |
| `PATCH /orders/:id/dimensions` with per-field history rows | done |
| `GET /orders/:id/timeline` — status + task events, oldest first | done |
| `workflow_tasks` collection + `GET/POST/PATCH` | done |
| `certificates` collection (new — not in the 17 spec §7 collections) | done — **rows are now written**: one per order at creation, exposed at `GET /orders/:id/certificate` |
| `document_requirements` collection + checklist template | done — **rows are now written** from `DOCUMENT_CHECKLIST` when an order opens; `GET /orders/:id/checklist` |
| `clients.email` has **no unique index, deliberately** | done — see the note below |
| Transaction helper with standalone fallback (Atlas M0 has no transactions) | done |
| Frontend: `ops-store.ts` clients/orders/tasks → real API | done |
| **55/55 live smoke** (45 B2 + 10 B3) · **91/91 automated** | done |

**The three B3 acceptance criteria, verified:**
1. **Multi-order client** — one client holds several orders (`orders?clientId=`).
2. **Snapshot survives a matrix edit** — repricing and expiring the route leaves
   the order's snapshot at its original value; a direct `updateOne` cannot
   rewrite it.
3. **Transition writes history + task in one transaction** — a status change
   appends the history row *and* upserts the stage task atomically on a replica
   set (and sequentially, visibly, on a standalone).

**Corrected in the audit pass.** The task upsert sat *outside* `withTransaction`,
so criterion 3 was not actually met: a crash between the two writes left an
order transitioned with no work item. Both writes are now inside the transaction.
`certificateStatus` also had no writable endpoint — it is in the schema and
rendered on every list view, but nothing could ever set it, so the badge was
permanently "Not Issued". It is now part of `PATCH /orders/:id/dimensions`.

**Transactions and the standalone caveat.** Multi-document transactions need a
replica set. Atlas free tier (M0) and the test in-memory server are single-node,
so `lib/transaction.ts` detects the "retryable writes not supported" error and
runs the same callback without a session. On a replica set — what production
should be — the writes are atomic. The difference is deliberate and documented
in the file rather than hidden.

**Why `clients.email` is not unique.** A unique index on email looks like an
obvious hardening and was briefly added during the audit pass — it immediately
broke the duplicate-client report test, and that failure is the reason it is not
there. `GET /clients/duplicates` exists to find and merge same-email clients
already in the system; a unique index would make those rows impossible to load,
so the report could never have anything to find and the B6 migration would abort
on the first duplicate. `POST /clients` rejects duplicates in the application;
the report is the control for historical data.

### B4 — Documents + Storage · ✅ COMPLETE

| Item | State |
|---|---|
| S3 adapter (`integrations/storage/s3.ts`) — MinIO / S3 / R2 behind one env-only switch | done |
| 15-min presigned upload + download URLs | done |
| Raw storage key never leaves the server (structurally omitted from the DTO) | done |
| `documents` collection + `document_requirements` + checklist template | done |
| Version-supersede: a new version marks prior ones `Superseded`, never overwriting | done |
| Concurrent-upload version race handled (unique index + recompute-and-retry) | done |
| Confirm-upload verifies the object exists before marking `Received` | done |
| Approve / reject with mandatory rejection reason | done |
| `document_access_logs` — upload / download / review, with actor, IP, request id | done |
| Document routes: list, upload-url, confirm-upload, download-url, review, access-log | done |
| Frontend: `ops-store.ts` documents → real API; `ops-seed.ts` deleted | done |
| **59/59 live smoke** (45 B2 + 10 B3 + 4 B4) · **105/105 automated** | done |

**The B4 acceptance criteria, verified:**
- **Upload → review → v2 flow** — a document moves `Not Received` → `Received`
  (only after the object is confirmed in the bucket) → `Approved`, and a second
  version supersedes the first.
- **Raw storage key never reaches the client** — `toDocumentDTO` strips it, and a
  test asserts the string `storageKey` appears in no API response. Clients get a
  presigned URL instead.
- **Access log rows exist** — upload, download and review each write a row with
  the actor, IP and request id.

**Storage is an env-only switch.** `STORAGE_PROVIDER` + `S3_*` select MinIO, S3
or R2 with no code change, per D4. The adapter is the only file that names any of
them. When no bucket is configured the endpoints return a clean 422
`STORAGE_NOT_CONFIGURED` rather than crashing — B1–B3 all work without storage.

### B1 — Server foundation · ✅ COMPLETE

| Item | State |
|---|---|
| npm workspaces (`server/` registered, deps hoisted to root `node_modules`) | done |
| `server/tsconfig.json` + `tsconfig.build.json` (NodeNext ESM, strict, isolatedModules) | done |
| zod env validation, fail-fast at import, blank-value = unset | done — `server/src/config/env.ts` |
| Mongoose connect / graceful disconnect / `dbState()` | done — `server/src/config/db.ts` |
| Pino logger with secret redaction; `x-request-id` correlation | done — `src/lib/logger.ts`, `src/middleware/request-log.ts` |
| Error handler (AppError, ZodError, Mongoose, malformed JSON, opaque 500) | done |
| Helmet, CORS allowlist, JSON body limit, `x-powered-by` disabled | done — `src/app.ts` |
| `GET /health` (liveness) + `GET /health/ready` (503 without Mongo) | done |
| Graceful shutdown (SIGTERM/SIGINT with 10s cap) | done — `server.ts` |
| Vitest + Supertest harness | done, green (18 B1 tests, 68 total after B2) |
| Server typecheck + build | done, clean |
| `docker-compose.yml` — redis + minio + bucket init (**no mongo**, per D3) | written — **unverified: Docker Desktop not installed on this machine** |
| `server/Dockerfile` + `.dockerignore` | written — **unverified: Docker Desktop not installed** |
| **Live Atlas connection** | ✅ **verified — `MongoDB connected`, `GET /health/ready` → 200 `{"status":"ready","db":"connected"}`** |

Verified: `server:typecheck` clean · `server:test` 18/18 · `server:build` emits `dist/` ·
boot without `MONGODB_URI` fails fast with an actionable message and exit 1 ·
frontend `npm run build` unaffected (1957 modules) · Atlas auth + TLS + `skills_connect_admin`
database reachable from the dev machine (IP allowlist correct) · `/health` reports
`db: connected` · `/health/ready` returns 200.

Config landed in the local, git-ignored `server/.env`: Atlas URI, generated
`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (used from B2). `server/.env.example` holds
placeholders only — verified no credential is present in it or anywhere in git history.

## 2. Repo layout (D2 — same repo, `server/` + npm workspaces)

```text
Admin SC/
├─ package.json            # workspaces: ["server"]; also hosts server:* scripts
├─ package-lock.json
├─ docker-compose.yml      # redis + minio + bucket init  (NO mongo — D3 uses Atlas)
├─ .dockerignore
├─ server/                 # Node + Express + TypeScript (ESM, NodeNext)
│  ├─ package.json         # @sc/server
│  ├─ tsconfig.json        # strict typecheck (src + tests)
│  ├─ tsconfig.build.json  # emit dist/
│  ├─ vitest.config.ts
│  ├─ Dockerfile
│  ├─ .env.example         # committed; placeholders only
│  ├─ .env                 # LOCAL ONLY, git-ignored, never committed
│  ├─ src/
│  │  ├─ config/           # B1: env.ts (zod), db.ts   ·  B5: redis.ts  ·  B4: s3.ts  ·  B5: qb.ts
│  │  ├─ lib/              # app-error.ts, logger.ts, version.ts
│  │  ├─ middleware/       # B1: request-log, error-handler, not-found
│  │  │                    # B2: requireAuth, requirePermission, auditLog, rateLimit
│  │  ├─ models/           # Mongoose schemas — 17 collections (§5)        [B2–B3]
│  │  ├─ routes/           # B1: health.ts  ·  thin routers → services    [B2–B6]
│  │  ├─ services/         # allocation, snapshots, transitions, sync     [B3–B5]
│  │  ├─ integrations/     # quickbooks/, storage/                        [B4–B5]
│  │  ├─ jobs/             # BullMQ queues + workers                      [B5]
│  │  ├─ scripts/          # excel-import, reconcile, seed-admin          [B6]
│  │  └─ app.ts / server.ts
│  └─ tests/               # Vitest + Supertest (B1: 18 tests)
├─ src/                    # frontend (existing, Day 1–5)
└─ node_modules/           # hoisted — one install for both packages
```

Note: the frontend and server keep separate `package.json` files; shared TypeScript
types will be extracted to a root-level location in B3 rather than cross-importing
between packages.

## 3. Phases (realistic estimate — NOT 5 days)

| Phase | Work | Days | Done when |
|---|---|---|---|
| **B1** Server foundation | Express+TS app, zod env config, Mongo connect, Redis client, error handler, request log, docker-compose (redis/minio), Vitest+Supertest harness, npm workspaces | 3–4 | ✅ **done** — typecheck clean, tests green, Atlas connected, `/health/ready` → 200 |
| **B2** Auth + RBAC | User/Role models, argon2id hashing, access JWT + rotating httpOnly refresh, revoke/logout, login rate-limit, `requirePermission` on every route, audit middleware. Frontend: real login via `api.ts` | 3–4 | ✅ **done** — wrong password rejected; refresh rotation + reuse detection tested; Sales gets 403 on `/users`; 68/68 unit + 45/45 live smoke |
| **B3** Masters + Clients/Orders | Remaining collections (incl. new `certificates`, `document_requirements`), client CRUD + dedupe report, order CRUD with **immutable price snapshots** + transactional transitions + history, tasks. Frontend stores → API calls | 4–5 | Multi-order client, snapshot survives matrix edit, transition writes history+task in one transaction |
| **B4** Documents + storage | S3 adapter (MinIO dev), **15-min signed upload/download URLs**, checklist templates, version-supersede, approve/reject, **document access logging**. Decision D4 locked | 3–4 | Upload→review→v2 flow; raw storage key never reaches client; access log rows exist |
| **B5** Finance + QuickBooks | Invoices, plans, instalments, payments, **server-authoritative allocation + overdue calc**, QB idempotent sync via BullMQ worker (same key = no duplicates), webhook/import, permission-gated retry | 4–5 | ✅ **code complete** — 145/145 tests, queue + worker + transport + webhook built. ⚠️ **criterion unproven end-to-end: no request has reached QuickBooks.** Needs QB sandbox creds + an OAuth'd company + one mapped client |
| **B6** Reports + Audit + Migration + Deploy | Aggregation pipelines (dashboard/reports), audit viewer indexes, Excel import scripts + reconciliation report, Docker prod image, staging deploy, UAT on migrated data | 5–7 | Dashboard numbers equal DB aggregations; import totals reconcile workbook vs DB vs QB; needs workbook + QB export + hosting |

**Progress:** B1–B5 are complete, audited line-by-line against this document,
and verified — including the queue and worker against a real Redis container.
**One external dependency remains: QuickBooks sandbox credentials** (blocker #4)
for a final confirmation run against Intuit's real API — the integration itself
is proven end-to-end against a contract-accurate stand-in over real HTTP.
**Remaining ≈ 13–18 working days** (B6).

## 3b. B5 — Finance + QuickBooks · ✅ CODE COMPLETE · ⚠️ CREDENTIALS OUTSTANDING

| Item | State |
|---|---|
| Invoices (server-allocated numbers, `INV-YYYY-NNNN`) + void, never delete | done |
| Payment plans with unlimited instalments, oldest-due-first allocation | done |
| Payments + refunds (reversing allocation, row retained) | done |
| **Server-authoritative allocation** — the client sends an amount, the server decides | done |
| **Overdue calculation** in `GET /finance/summary`, invoice status derived not stored | done |
| `qb_sync_records` — unique `idempotencyKey`, attempts counter, last error | done |
| **BullMQ queue** (`jobs/qb-sync.queue.ts`) + **worker** (`jobs/qb-sync.worker.ts`) | done |
| Redis client (`config/redis.ts`) with inline fallback when Redis is absent | done — **was broken against real Redis: it used `node-redis`, which BullMQ rejects. Rewritten on ioredis with two clients (commands bounded, queue `maxRetriesPerRequest: null`).** |
| **Real QuickBooks transport** (`integrations/quickbooks/client.ts`) — OAuth2, token refresh, v3 invoice + payment POSTs | done |
| Token storage (`qb_connections`) with `select:false` on both secrets | done |
| Payload mapping (`integrations/quickbooks/payloads.ts`) — named refusals, never a malformed body | done |
| **Webhook** `POST /integrations/quickbooks/webhook` — HMAC over the raw body, constant-time compare | done |
| OAuth connect + callback (`settings.manage`, `state` bound to the session) | done |
| Permission-gated retry (`qb.retry`), runs the identical attempt handler inline | done |
| **Redis-backed rate limiting** — replaces the in-process counters B2 deferred | done |
| Redelivered job on an already-`Synced` record is a no-op | done |
| **Manual retry of an already-`Synced` record is also a no-op** | done — **added in the audit pass; it used to create a duplicate invoice in QuickBooks** |
| Frontend: `fin-store.ts` → real API; `fin-seed.ts` deleted | done |
| **174/174 automated** · smoke extended with 10 B5 checks | done |

**Deviations from the 17-collection list:** `qb_connections` was added, holding
the OAuth token pair for the single QuickBooks company. Like B2's
`refresh_tokens`, it is infrastructure rather than a business entity, and the
17 spec §7 collections remain the business data model. `Client.qbCustomerId` was
also added: QuickBooks issues customer ids from its own database, so they cannot
be derived — an invoice for an unmapped client fails the sync with a named
reason rather than creating a broken QB record.

**What is deliberately NOT here.** Queueing is not a correctness requirement:
`enqueueQBSync` runs the identical handler inline when Redis is unreachable, so
the fallback cannot drift from the queued path. And `qbReference` is now only
ever the id QuickBooks itself issued — an earlier version invented one when the
transport reported success without a reference, which produced references that
matched nothing and would have made the B6 reconciliation silently drop every
row it joined on.

**To finish B5:** fill `QB_REALM_ID` / `QB_CLIENT_ID` / `QB_CLIENT_SECRET` /
`QB_WEBHOOK_SECRET` in `server/.env`, then `GET /integrations/quickbooks/connect`
as an admin to authorise the company. Nothing else changes.

### B5 design notes worth keeping

- **The webhook needs the raw body.** Intuit signs the exact bytes it sent. Once
  `express.json()` has parsed the body, re-serialising it does not reproduce
  those bytes and the HMAC can never match — so `app.ts` mounts that one path
  with `express.raw()` *before* the JSON parser.
- **The webhook router's route is `/`, not `/webhook`.** It is mounted at
  `/integrations/quickbooks/webhook`; declaring `/webhook` inside made the real
  URL `.../webhook/webhook`, and every callback silently fell through to the
  authenticated router and came back 401. A test now pins the URL.
- **Retry does not use the queue.** The automatic path queues; a manual retry
  runs the same `runAttempt` inline so the operator sees the result in the
  response.
- **A refused sync is not retried by BullMQ.** `processSyncRecord` resolves after
  recording the failure, so an unmapped client does not get five retries against
  QuickBooks' API for something only a human can fix.

### B5 — what is verified, and what still needs a human

**Verified end-to-end, over real HTTP.** `tests/qb-integration.test.ts` points the
client at a local stand-in that speaks Intuit's OAuth and v3 contract
(`tests/helpers/qb-stub.ts`): the authorization-code exchange, the invoice and
payment creates, the `Fault.Error[]` rejection shape, token rotation, and the
401 → refresh → retry path all run for real. The headline criterion is proven:

```
create → QuickBooks refuses → retry → Synced → two more retries → still exactly one QB record
```

Before that suite existed the criterion was *asserted* but never *exercised* —
which is exactly how the retry-creates-a-duplicate bug survived three phases and
an audit. The stub makes it testable; the unique Mongo key makes it safe.

**Still needs a human: an Intuit sandbox run.** The stub proves our client, our
payload mapping, our retry guard, our idempotency and our token handling. It
cannot prove that Intuit behaves as documented. For that, set `QB_REALM_ID` /
`QB_CLIENT_ID` / `QB_CLIENT_SECRET` / `QB_WEBHOOK_SECRET` in `server/.env`, then
`GET /integrations/quickbooks/connect` as an admin. Nothing else changes.

### Two bugs Docker exposed, which the test suite could not have caught

Both shipped inside B5 and stayed hidden because the suite always ran with Redis
absent — everything green was the *inline fallback*, and the BullMQ path never
executed.

1. **BullMQ rejected the Redis client.** `config/redis.ts` used the `node-redis`
   package. BullMQ requires an ioredis-compatible client and throws *"could not
   load the optional 'ioredis' package"* — so `getQBQueue()` and `startQBWorker()`
   would have thrown the moment Docker came up, and no queue would ever have
   been created. Rewritten on ioredis, with **two** clients: BullMQ needs
   `maxRetriesPerRequest: null` (a worker blocks on commands that wait
   indefinitely) while the rate limiter needs it bounded (a Redis stall inside
   `POST /auth/login` must fail into the in-process fallback rather than hang).
2. **`REDIS_URL` parsed to a NaN port.** The scheme was stripped *after*
   splitting on ":", so `redis://localhost:6379` yielded `"//localhost"` and
   `Number("//localhost") === NaN`, which ioredis rejects. Replaced with
   `parseRedisUrl()`, which strips the scheme first.

`npm run server:verify:queue` is what caught the first one — it failed loudly
instead of silently degrading, which is the point of having it.

**The lesson is structural, not incidental.** A fallback path is only as trustworthy
as something that forces it to run. The inline fallback was well tested; the
queued path — the one that matters in production — had never once executed.
The same gap existed for the QuickBooks transport, which is why the suite now
talks to a real HTTP stand-in rather than an injected function.

### Verifying the queue once Docker is running

The whole test suite runs with Redis absent, because Docker was not installed —
so everything green in CI was the *inline fallback*, and the BullMQ path had
never actually executed. With Docker up:

```powershell
docker compose up -d
npm run server:verify:queue
```

It runs on its own queue, `qb-sync-verify`, rather than `qb-sync` — a live dev
server has a worker on `qb-sync` and would consume the probe job first, making
the check pass only when nothing else is connected.

**10/10 green** against the real Redis container. It also verifies it leaves the
queue empty, so a stale job is never picked up by a worker on the next run.

**One flake is worth recording.** The suite now pins `REDIS_URL` to a *closed*
port in `vitest.config.ts`. Without that, the suites share one real Redis and
every file signs in as `admin@example.com` from `127.0.0.1` — the login counter
accumulated across parallel files and 125 tests failed with `429`. The
fallback is deterministic; the real path is verified by `verify:queue`.

## Live smoke against the real server and Atlas

`npm run server:smoke` with the server running passes **69/69** — B2, B3, B4 and
the 10 B5 checks, over HTTP against the production-shaped configuration rather
than in-process.

Getting there exposed two more defects the suite could not have caught:

- **The sales fixture was never reactivated.** The smoke script deactivated
  `smoke-sales@example.com` to test that access dies immediately, then left it
  that way. Every later run failed "sales user can sign in" with a 403 that
  looks like a security bug but is really leftover test state. Now restored.
- **The login rate limit blocked the suite itself.** 14 logins per run against a
  limit of 5 per 15 minutes meant the suite could never complete. The limit is
  env-configured precisely so this is a config choice, not a code change:
  `server/.env` now sets `LOGIN_RATE_LIMIT_MAX=100` for local dev (documented in
  `.env.example`, with production kept at the default 5). The per-account lockout
  at 10 failures is unchanged and remains the real brute-force control.

### Cross-cutting gaps closed in the audit pass

| Requirement | Before | Now |
|---|---|---|
| Global rate limit (§6) | **absent** — only `/auth/login` was limited; `/payments`, `/users`, `qb.retry` and everything else was unthrottled | `middleware/global-rate-limit.ts`, mounted in `app.ts`, 300 req/min per IP, skipped for health probes |
| Overdue cron job (§6) | **absent** — an invoice past its due date kept reading `Sent` until an unrelated payment event; `InstalmentStatus "Overdue"` was an unreachable enum value | `jobs/overdue.job.ts`, hourly `setInterval`, sweeps invoices and instalments |
| Upload type/size whitelist (§6) | **absent** — `contentType` was a free 200-char string; no size was accepted or checked anywhere | `lib/uploads.ts` allowlist enforced at the route, and the real byte count verified from the bucket on confirm-upload |
| Full RBAC matrix test (§7) | **absent** — `Operations`, `RTO / Sourcing Manager` and `Read Only / Manager` were never asserted against anything | `tests/coverage.test.ts` walks all 7 roles × 15 routes |
| Margin test (§7) | **absent** — `grossMargin` was exported but imported nowhere, while the frontend had its own copy | tested against the server, including the negative-margin case |
| Filter sanitization (§6) | ad-hoc, duplicated in two files, no test | one shared `escapeRegex`, with a test proving `.*` does not become match-all |
| Document supersede race | two concurrent uploads could mark *each other* superseded, leaving an order with no active version | `version: { $lt }` ceiling on the supersede update |
| Storage error handling | a `403` from the bucket was reported as "file not found", hiding credential faults | `403` is now surfaced as a configuration error; missing storage and missing file are distinct errors |

## 4. API contract (store function → endpoint)

| Store group | REST endpoints |
|---|---|
| roles/users | `GET /roles`, `GET /users`, `POST /users`, `PATCH /users/:id` |
| qualifications | `GET /qualifications`, `POST /qualifications` |
| rtos | `GET /rtos`, `POST /rtos` |
| agents | `GET /agents`, `POST /agents`, `PATCH /agents/:id` |
| supplier routes | `GET /supplier-routes`, `POST /supplier-routes`, `POST /supplier-routes/:id/expire` |
| clients | `GET /clients`, `POST /clients`, `GET /clients/:id` (profile), `GET /clients/duplicates`, `PATCH /clients/:id` |
| orders | `GET /orders` (filters), `POST /orders` (body carries `clientId`), `GET /orders/:id`, `GET /orders/:id/checklist`, `GET /orders/:id/certificate` |
| workflow | `PATCH /orders/:id/status`, `PATCH /orders/:id/dimensions`, `GET /orders/:id/timeline`, `GET /workflow/tasks`, `PATCH /workflow/tasks/:id` |
| documents | `GET /orders/:id/documents`, `POST /documents/upload-url` (allocates the next version itself, so there is no separate `/versions` route), `POST /documents/:id/confirm-upload`, `GET /documents/:id/download-url`, `PATCH /documents/:id/review`, `GET /orders/:id/documents/access-log` |
| invoices | `GET /invoices`, `POST /invoices`, `POST /invoices/:id/void` |
| plans/payments | `GET/POST /orders/:id/payment-plan`, `POST /payment-plans/:id/instalments`, `GET /payments`, `POST /payments`, `POST /payments/:id/refund` |
| reports | `GET /reports/finance`, `GET /reports/*` (revenue, ageing, margin, funnel) |
| quickbooks | `GET /integrations/quickbooks/status`, `GET /integrations/quickbooks/connect`, `GET /integrations/quickbooks/callback`, `GET /integrations/quickbooks/sync`, `GET /integrations/quickbooks/sync/:type/:id`, `POST /integrations/quickbooks/sync/:type/:id`, `POST /integrations/quickbooks/webhook` |
| audit | `GET /audit` (filters) |
| auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |

**Frontend cutover (no page rewrites):** `src/lib/api.ts` (`apiFetch` + auto
refresh); `store.ts` / `ops-store.ts` / `fin-store.ts` kept identical signatures
and now all call the API. `src/mocks/` is **deleted** — every store is on the
real backend. RBAC matrix lives in `server/src/services/permissions.ts` as the
single source; the frontend copy in `src/lib/permissions.ts` is display-only and
hand-maintained (it is not generated).

## 5. Data model (spec §7 — 17 collections)

`users, roles, clients, agents, qualifications, licensingRefs (embedded), rtos,
supplier_routes, orders, payment_plans, payments, invoices, documents,
document_requirements, workflow_tasks, certificates (new), audit_logs, qb_sync_records`

Infrastructure collections, documented rather than silently introduced (same
precedent as B2's `refresh_tokens`): **`refresh_tokens`** (session state, D1),
**`qb_connections`** (the OAuth token pair, B5), **`counters`** (invoice-number
allocation, `INV-YYYY-NNNN`). `document_access_logs` lives inside the documents
model file and is likewise infrastructure, not a spec §7 entity.

Enforced in Mongoose: order price snapshots immutable after create; document version
unique per (order, type, version); `audit_logs` append-only (query middleware);
instalments unlimited; routes soft-expire only. **`clients.email` is deliberately
NOT unique** — see the B3 note.

## 6. Security design

- Passwords: argon2id. Access JWT 15 min (memory only). Refresh: httpOnly + SameSite + Secure cookie, rotation with reuse detection, server revocation table.
- Every route: `requireAuth` → `requirePermission('<perm>')` — frontend hiding is UX only. Four deliberate exceptions (`/auth/me`, `/auth/permissions`, `/auth/logout-all`, `/users/directory`) need auth but no permission.
- Audit middleware captures actor, entity, before/after, IP on all mutations. Implemented as 28 explicit `recordAudit()` call sites rather than middleware — coverage is complete but it is a convention, not an enforced invariant.
- Files: private bucket, 15-min signed URLs, **type/size whitelist** (`lib/uploads.ts`, enforced at the route and verified against the bucket's real byte count on confirm-upload), path `/clients/{c}/orders/{o}/{type}/{v}`.
- Hardening: helmet, CORS allowlist, **login + global rate limits** (Redis-backed, in-process fallback), zod on every body, filter sanitization (`escapeRegex`, shared), **overdue cron job** (`jobs/overdue.job.ts`).

## 7. Testing strategy

- Unit: allocation, overdue (including the scheduled sweep), margin, snapshots,
  transition guards, idempotency keys.
- Integration (Supertest): full RBAC matrix (each role × each route), order
  lifecycle, document versioning, invoice→payment→balance, QB retry-creates-one
  (proven against an injected transport that counts calls).
- Migration: row counts + totals reconcile (workbook vs DB vs QB) — **B6, not yet built**.

**174 automated cases across 10 suites.** All three areas the audit found missing
(full RBAC matrix, margin, and the overdue sweep) now have coverage, and the
QuickBooks transport has an injection seam so the headline criterion is testable
without credentials.

## 8. External blockers (owner provides)

1. ~~MongoDB Atlas~~ — ✅ **supplied and verified.** URI lives in git-ignored `server/.env`;
   `skills_connect_admin` reachable from the dev machine; `GET /health/ready` returns 200.
   Reminder: if that password is ever reused elsewhere, rotate it in Atlas and update `.env`.
2. Storage: **R2 credentials** (bucket + API token) — D4 locked, consumed in B4.
3. Redis: local Docker compose, no external blocker. **Docker Desktop is not installed** on the
   dev machine, so `docker compose up` and the Dockerfile remain unverified.
4. QuickBooks: sandbox app creds + realm ID + export for reconciliation (B5/B6).
   **This is the only thing B5 still waits on.** Everything else in B5 is built
   and tested; supplying these makes the sync live.
5. `RTO & Onboarding Master Hub.xlsx` workbook (B6).
6. Hosting: VPS/Docker target (Railway/Render/own server?) (B6).

## 9. Resume instruction

When a new session starts, read in order: `BACKEND-PLAN.md` → `workflow.md` §15 →
`HANDOVER.md` → `architecture.md` §1–§2. Then continue from the first phase whose
status is not `completed`. Track work with the todo list; user runs all git
operations (no auto commit/push).

**B1–B5 are complete in code. Next phase is B6 (Reports + Audit + Migration +
Deploy)** — aggregation pipelines for the dashboard and reports, an audit viewer,
the Excel import and reconciliation scripts, the production image and the
staging deploy. B6's reconciliation work is what consumes the QuickBooks side,
so blocker #4 (sandbox credentials + export) gates its second half rather than
its first.
