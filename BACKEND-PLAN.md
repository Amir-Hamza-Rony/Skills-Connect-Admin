# BACKEND PLAN — Skills Connect Admin (Phase B1–B6)

> Companion to `architecture.md` (§1 target) and `workflow.md` (§15 roadmap).
> Status: **planned, not started**. Front-end shell (Day 1–5, 19 commits on
> `rony-dev`) is complete with an in-memory preview store; this document
> defines how the real backend replaces it.
> Source of truth for requirements: `Skills_Connect_Admin_Software_Developer_Specification.docx`.

## 0. Starting facts (verified)

- Repo root `D:/Office Work/Admin SC`, branch `rony-dev`. Only `src/` exists — **no backend code**.
- 3 preview stores, all async + REST-shaped (57 functions total):
  - `src/lib/store.ts` — masters: roles, users, qualifications, RTOs, agents, supplier routes
  - `src/lib/ops-store.ts` — clients, orders (+snapshots/history), documents (+versions/review), tasks
  - `src/lib/fin-store.ts` — invoices, plans, instalments, payments (+allocation), QB sync, audit
- Auth is preview: any password accepted, session id in `localStorage`, no hashing.
- RBAC lives only in `src/lib/permissions.ts` (7 roles × 18 permissions) — **no server enforcement**.
- Missing vs spec §7: `certificates` entity, `communications` (optional), `document_requirements` as a collection.
- Secrets rule: real connection strings/keys go in local `.env` ONLY — never in chat, code, or git.

## 1. Proposed decisions (defaults — confirm before B2/B4, else these stand)

| # | Decision | Proposed default | Needed for |
|---|---|---|---|
| D1 | Auth strategy | **JWT access (15 min) + rotating refresh in httpOnly cookie** (spec §3 permits JWT/session) | B2 |
| D2 | Repo layout | **Same repo, `server/` folder, npm workspaces** (atomic commits, shared types) | B1 |
| D3 | Mongo for dev | **Local Docker Mongo**; Atlas for staging/prod via `MONGODB_URI` | B1/B3 |
| D4 | Object storage | **MinIO locally** (S3-compatible); AWS S3 or Cloudflare R2 in prod | B4 |

User offered a MongoDB Atlas URL: it will be consumed as `MONGODB_URI` from `.env` only.
Atlas also needs: database name (proposed `skills_connect_admin`), IP allowlist entry,
live cluster (M0 free tier is enough for dev).

## 2. Proposed repo layout

```text
Admin SC/
├─ package.json            # workspaces: [".", "server"] (D2 decision)
├─ server/                 # NEW — Node + Express + TypeScript
│  ├─ src/
│  │  ├─ config/          # env.ts (zod validation), db.ts, redis.ts, s3.ts, qb.ts
│  │  ├─ models/          # Mongoose schemas — 17 collections (§5)
│  │  ├─ middleware/      # requireAuth, requirePermission, auditLog, errorHandler, rateLimit
│  │  ├─ routes/          # thin routers → services
│  │  ├─ services/        # business rules (allocation, snapshots, transitions, sync)
│  │  ├─ integrations/    # quickbooks/, storage/
│  │  ├─ jobs/            # BullMQ queues + workers
│  │  ├─ scripts/         # excel-import, reconcile, seed-admin
│  │  └─ app.ts / server.ts
│  └─ tests/              # unit + integration (Vitest + Supertest)
├─ src/                    # frontend (existing)
└─ docker-compose.yml      # mongo + redis + minio (dev)
```

## 3. Phases (realistic estimate — NOT 5 days)

| Phase | Work | Days | Done when |
|---|---|---|---|
| **B1** Server foundation | Express+TS app, zod env config, Mongo connect, Redis client, error handler, request log, docker-compose (mongo/redis/minio), Vitest+Supertest harness, npm workspaces | 3–4 | `GET /health` green; `docker compose up` gives mongo+redis+minio; CI runs `build+lint+test` |
| **B2** Auth + RBAC | User/Role models, argon2id hashing, access JWT + rotating httpOnly refresh, revoke/logout, login rate-limit, `requirePermission` on every route, audit middleware. Frontend: real login via `api.ts` | 3–4 | Wrong password rejected; refresh rotation + reuse detection tested; Sales user gets 403 on `/users`; decisions D1–D3 locked |
| **B3** Masters + Clients/Orders | Remaining collections (incl. new `certificates`, `document_requirements`), client CRUD + dedupe report, order CRUD with **immutable price snapshots** + transactional transitions + history, tasks. Frontend stores → API calls | 4–5 | Multi-order client, snapshot survives matrix edit, transition writes history+task in one transaction |
| **B4** Documents + storage | S3 adapter (MinIO dev), **15-min signed upload/download URLs**, checklist templates, version-supersede, approve/reject, **document access logging**. Decision D4 locked | 3–4 | Upload→review→v2 flow; raw storage key never reaches client; access log rows exist |
| **B5** Finance + QuickBooks | Invoices, plans, instalments, payments, **server-authoritative allocation + overdue calc**, QB idempotent sync via BullMQ worker (same key = no duplicates), webhook/import, permission-gated retry | 4–5 | Payment→balance math matches frontend; failed sync→retry→Synced with one QB record; needs QB sandbox creds |
| **B6** Reports + Audit + Migration + Deploy | Aggregation pipelines (dashboard/reports), audit viewer indexes, Excel import scripts + reconciliation report, Docker prod image, staging deploy, UAT on migrated data | 5–7 | Dashboard numbers equal DB aggregations; import totals reconcile workbook vs DB vs QB; needs workbook + QB export + hosting |

**Total ≈ 22–30 working days.** B1–B3 (≈10–13 days) gets the frontend running on real data — the fastest path to "real product" feel.

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

1. MongoDB: Atlas URL + db name + IP allowlist (offered — pending).
2. Storage: S3/R2/MinIO choice + bucket creds (B4).
3. Redis: local Docker vs managed (B1/B5).
4. QuickBooks: sandbox app creds + realm ID + export for reconciliation (B5/B6).
5. `RTO & Onboarding Master Hub.xlsx` workbook (B6).
6. Hosting: VPS/Docker target (Railway/Render/own server?) (B6).

## 9. Resume instruction

When a new session starts, read in order: `BACKEND-PLAN.md` → `workflow.md` §15 →
`HANDOVER.md` → `architecture.md` §1–§2. Then continue from the first phase whose
status is not `completed`. Track work with the todo list; user runs all git
operations (no auto commit/push).
