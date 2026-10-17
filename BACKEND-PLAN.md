# BACKEND PLAN — Skills Connect Admin (Phase B1–B6)

> Companion to `architecture.md` (§1 target) and `workflow.md` (§15 roadmap).
> Status: **B3 complete** (see §1.3). Front-end shell (Day 1–5, 19 commits on
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
| Login rate limit (per IP+email) + per-account lockout | done |
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
- **Rate limiting is in-process** until B5 swaps it for Redis; with more than one
  replica the effective limit would otherwise multiply by the replica count.

### B3 — Masters + Clients/Orders · ✅ COMPLETE

| Item | State |
|---|---|
| Master collections: `agents`, `qualifications` (licensing refs embedded), `rtos`, `supplier_routes` | done |
| `clients` collection + `GET/POST/PATCH /clients`, `GET /clients/:id` | done |
| Duplicate-client report (`certain` by email, `possible` by phone) | done |
| `orders` collection with **immutable** `supplierCostSnapshot` | done |
| Snapshot enforced 3 ways: `immutable: true`, pre-update hooks, server reads the route | done |
| Order create refuses when no active route matches (no zero-cost orders) | done |
| Status transition writes history **and** stage task in one transaction | done |
| `PATCH /orders/:id/dimensions` with per-field history rows | done |
| `GET /orders/:id/timeline` — status + task events, oldest first | done |
| `workflow_tasks` collection + `GET/POST/PATCH` | done |
| `certificates` collection (new — not in the 17 spec §7 collections) | done |
| `document_requirements` collection + checklist template | done |
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

**Transactions and the standalone caveat.** Multi-document transactions need a
replica set. Atlas free tier (M0) and the test in-memory server are single-node,
so `lib/transaction.ts` detects the "retryable writes not supported" error and
runs the same callback without a session. On a replica set — what production
should be — the writes are atomic. The difference is deliberate and documented
in the file rather than hidden.

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
| **B5** Finance + QuickBooks | Invoices, plans, instalments, payments, **server-authoritative allocation + overdue calc**, QB idempotent sync via BullMQ worker (same key = no duplicates), webhook/import, permission-gated retry | 4–5 | Payment→balance math matches frontend; failed sync→retry→Synced with one QB record; needs QB sandbox creds |
| **B6** Reports + Audit + Migration + Deploy | Aggregation pipelines (dashboard/reports), audit viewer indexes, Excel import scripts + reconciliation report, Docker prod image, staging deploy, UAT on migrated data | 5–7 | Dashboard numbers equal DB aggregations; import totals reconcile workbook vs DB vs QB; needs workbook + QB export + hosting |

**Progress:** B1 and B2 are complete — roughly 6–8 of the 22–30 working days.
**Remaining ≈ 18–24 working days** (B3–B6). B3 is the next phase and is what moves the
bulk of the UI onto real data.

## 4. API contract (store function → endpoint)

| Store group | REST endpoints |
|---|---|
| roles/users | `GET /roles`, `GET /users`, `POST /users`, `PATCH /users/:id` |
| qualifications | `GET /qualifications`, `POST /qualifications` |
| rtos | `GET /rtos`, `POST /rtos` |
| agents | `GET /agents`, `POST /agents`, `PATCH /agents/:id` |
| supplier routes | `GET /supplier-routes`, `POST /supplier-routes`, `POST /supplier-routes/:id/expire` |
| clients | `GET /clients`, `POST /clients`, `GET /clients/:id` (profile + timeline), `GET /clients/duplicates` |
| orders | `GET /orders` (filters), `POST /clients/:id/orders`, `GET /orders/:id` |
| workflow | `PATCH /orders/:id/status`, `PATCH /orders/:id/dimensions`, `GET /orders/:id/timeline`, `GET/PATCH /workflow/tasks` |
| documents | `GET /orders/:id/documents`, `POST /documents/upload-url`, `POST /documents/:id/versions`, `PATCH /documents/:id/review` |
| invoices | `GET /invoices`, `POST /invoices`, `POST /invoices/:id/void` |
| plans/payments | `GET/POST /orders/:id/payment-plan`, `POST /payment-plans/:id/instalments`, `GET /payments`, `POST /payments`, `POST /payments/:id/refund` |
| reports | `GET /reports/finance`, `GET /reports/*` (revenue, ageing, margin, funnel) |
| quickbooks | `GET /integrations/quickbooks/sync`, `POST /integrations/quickbooks/sync/:type`, `POST /integrations/quickbooks/webhook` |
| audit | `GET /audit` (filters) |
| auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |

**Frontend cutover (no page rewrites):** add `src/lib/api.ts` (`apiFetch` + auto refresh);
`store.ts` / `ops-store.ts` / `fin-store.ts` keep **identical signatures** and call the API;
delete `src/mocks/*`. RBAC matrix moves to `server/` as single source (frontend copy generated).

## 5. Data model (spec §7 — 17 collections)

`users, roles, clients, agents, qualifications, licensingRefs (embedded), rtos,
supplier_routes, orders, payment_plans, payments, invoices, documents,
document_requirements, workflow_tasks, certificates (new), audit_logs, qb_sync_records`

Enforced in Mongoose: order price snapshots immutable after create; document version
unique per (order, type, version); `audit_logs` append-only (no update/delete);
instalments unlimited; routes soft-expire only.

## 6. Security design

- Passwords: argon2id. Access JWT 15 min (memory only). Refresh: httpOnly + SameSite + Secure cookie, rotation with reuse detection, server revocation table.
- Every route: `requireAuth` → `requirePermission('<perm>')` — frontend hiding is UX only.
- Audit middleware captures actor, entity, before/after, IP on all mutations.
- Files: private bucket, 15-min signed URLs, type/size whitelist, path `/clients/{c}/orders/{o}/{type}/{v}`.
- Hardening: helmet, CORS allowlist, login + global rate limits, zod on every body, filter sanitization, overdue cron job.

## 7. Testing strategy

- Unit: allocation, overdue, margin, snapshots, transition guards, idempotency keys.
- Integration (Supertest): full RBAC matrix (each role × each route), order lifecycle, document versioning, invoice→payment→balance, QB retry-creates-one.
- Migration: row counts + totals reconcile (workbook vs DB vs QB), duplicate-client report.

## 8. External blockers (owner provides)

1. ~~MongoDB Atlas~~ — ✅ **supplied and verified.** URI lives in git-ignored `server/.env`;
   `skills_connect_admin` reachable from the dev machine; `GET /health/ready` returns 200.
   Reminder: if that password is ever reused elsewhere, rotate it in Atlas and update `.env`.
2. Storage: **R2 credentials** (bucket + API token) — D4 locked, consumed in B4.
3. Redis: local Docker compose, no external blocker. **Docker Desktop is not installed** on the
   dev machine, so `docker compose up` and the Dockerfile remain unverified.
4. QuickBooks: sandbox app creds + realm ID + export for reconciliation (B5/B6).
5. `RTO & Onboarding Master Hub.xlsx` workbook (B6).
6. Hosting: VPS/Docker target (Railway/Render/own server?) (B6).

## 9. Resume instruction

When a new session starts, read in order: `BACKEND-PLAN.md` → `workflow.md` §15 →
`HANDOVER.md` → `architecture.md` §1–§2. Then continue from the first phase whose
status is not `completed`. Track work with the todo list; user runs all git
operations (no auto commit/push).

**B1 is complete. B2 is complete. Next phase is B3 (Masters + Clients/Orders)** —
it builds the remaining spec §7 collections, moves agents/qualifications/RTOs/supplier
routes plus clients/orders/documents/tasks off the preview stores, and adds the
`certificates` entity the spec requires.
