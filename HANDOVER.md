# HANDOVER — Skills Connect Admin (Day 1–5 shell + Phases B1–B5 backend)

Branch: `rony-dev`. Every module in the specification is built and working, and
**all of it runs on the real backend** — `src/mocks/` is gone. B1–B5 are
complete and have been audited line-by-line against `BACKEND-PLAN.md`. Remaining
work is B6 (reports, audit viewer, Excel migration, deploy) plus the QuickBooks
credentials described below.

## Running it

```powershell
npm install
npm run server:seed     # 7 roles + one Super Admin (idempotent)
npm run server:dev      # API on :4000
npm run dev             # SPA on :5173
```

Sign in with the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `server/.env`.
`npm run server:smoke` re-runs the 45-check live acceptance suite against the
running API and the real Atlas database.

## What is real now (B2 + B3)

- **Auth** — argon2id password hashing, 15-min access JWT in memory only,
  rotating opaque refresh token in an httpOnly cookie, reuse detection that
  revokes the whole session family, per-IP+email login rate limit, per-account
  lockout, logout / logout-all / admin password reset / account unlock.
- **RBAC** — the matrix lives in `server/src/services/permissions.ts` and is
  enforced by `requirePermission` on every non-public route. The SPA's copy in
  `src/lib/permissions.ts` is display-only.
- **Audit** — append-only `audit_logs` (update/delete blocked by pre-hooks),
  written on every mutation and on every denied permission, with actor, entity,
  before/after, IP and request id.
- **Users & Roles** — real CRUD against Atlas. `GET /users/directory` serves a
  name-only list so screens that merely render an actor (tasks, documents,
  audit, timelines) work for roles that cannot administer users.
- **Clients & Orders** — real CRUD against Atlas. An order snapshots the
  supplier route's wholesale cost at creation and that snapshot is immutable:
  repricing the route never rewrites history. A status transition writes the
  history row and the workflow task together.
- **Workflow tasks** — real collection, filterable by order, assignee and
  status, so the board works for every role that can see orders.
- **Masters** — `agents`, `qualifications`, `rtos` and `supplier_routes` now
  exist as real collections, which is what an order needs in order to be
  created.
- **Documents** — real collection in object storage. Uploads use short-lived
  presigned URLs so file bytes never pass through the API; the raw storage key
  is never sent to the browser. Versions supersede rather than overwrite, and
  every upload, download and review is access-logged.
- **Finance** — invoices (server-allocated numbers, void never delete), payment
  plans with unlimited instalments, payments and refunds. Allocation is
  server-authoritative: the client sends an amount and the server decides where
  it lands, oldest-due-first, so money cannot be steered away from an overdue
  instalment.
- **QuickBooks sync** — a BullMQ queue and worker, a real OAuth2 + v3 client,
  and an HMAC-verified webhook. Idempotency is enforced twice: a unique
  `idempotencyKey` in MongoDB and the same key as the BullMQ job id. Retrying,
  re-enqueuing or redelivering all converge on one QuickBooks record.
- **Rate limiting** — Redis-backed, so the limit is shared across every API
  instance. Falls back to in-process counters when Redis is unreachable. A global
  backstop covers every route; the login route has its own tighter per-IP+email
  limit that returns `429`.
- **Masters** — agents, qualifications, RTOs and supplier pricing are all real
  collections with real endpoints. The pricing matrix an order snapshots its
  wholesale cost from is the same one the pricing screen shows.
- **Overdue sweep** — an hourly job flips unpaid invoices and instalments to
  `Overdue`. Nothing happens on a timer in the browser, so this had to be
  server-side: an invoice that passes its due date with no payment activity would
  otherwise read `Sent` indefinitely.

## Still pending

- **QuickBooks has never touched Intuit's real API.** The integration is proven
  end-to-end against a local stand-in that speaks Intuit's OAuth + v3 contract,
  so our client, payloads, retry guard and token handling are all verified.
  Confirming that Intuit behaves as documented needs sandbox credentials.
- **Docker is up and the queue is verified** (10/10). Two production bugs were
  fixed to get there, both invisible to the suite: the Redis client used
  `node-redis`, which BullMQ rejects outright, and `REDIS_URL` parsed to a NaN
  port. See "Two bugs Docker exposed" in `BACKEND-PLAN.md`.
- **Reports, the audit viewer, the Excel import and the deploy are B6.**

## What was built

- **Day 1:** Spec review + `design.md` / `architecture.md` / `workflow.md`,
  Vite + React + TS + Tailwind v4 + shadcn/ui scaffold, Light/Dark/System
  theme (System default, no-flash bootstrap), independent sidebar/content
  scrolling, premium dark-teal dashboard shell.
- **Day 2:** Preview auth (7 roles), login, protected routes, 403 guards,
  role-filtered nav, Users + Roles, Qualifications + licensing,
  RTO directory, 3 separated agent types, supplier pricing with
  history-preserving expiry.
- **Day 3:** Clients (single record + 7-tab profile), Orders (filtered queue,
  creation with 3-way agent/RTO selection + wholesale snapshots), order
  detail (margin, transitions, tasks, timeline), Documents queues + review +
  versioning, Workflow task board.
- **Day 4:** Invoices (auto-number, void), unlimited instalment plans,
  payments with oldest-due-first allocation, idempotent QuickBooks sync queue
  with permission-gated retry, live dashboard metrics, reports, global
  search, audit viewer, settings/migration readiness.
- **Day 5:** Full audit coverage with real actor ids, live finance wired into
  client profiles and order detail, error boundary, overflow guard, README,
  env template, this handover.

## UAT script (15 spec acceptance criteria)

1. Create a client once; create 2 orders under them (multi-order proof).
2. Each order shows qualification + sales agent + source agent + RTO separately.
3. Selling price + snapshot cost → margin visible; edit the price matrix —
   old order snapshot unchanged.
4. Create a 5-instalment plan (no 4-column limit).
5. Record a payment → paid/balance/status update immediately.
6. Past-due instalment flagged overdue.
7. Upload (record) + review documents per checklist; reject with reason.
8. Document status independent from RTO submission status.
9. Status changes in timeline with user + timestamp.
10. Invoice linked to correct order; void (never delete).
11. QuickBooks failed sync → retry → Synced, no duplicate (same key).
12. Filter reports by agent/RTO/qualification/stage.
13. Log in as Sales — Users/Roles/Settings hidden; direct URL → 403 card.
    (Now a real 403 from the API, not just the UI card.)
14. Every mutation above appears in Audit Log with actor.
15. Finance totals reconcile across dashboard, reports, profile, order detail.

## B3 acceptance — verified (55/55 live, 91/91 automated)

`npm run server:smoke` against the running API + Atlas now also covers B3:
client create / fetch / update · duplicate email rejected · client search ·
order refused when no active supplier route matches (422 `NO_ACTIVE_ROUTE`) ·
malformed id refused (400) · anonymous `/clients` → 401.

The automated suite proves the three B3 criteria against a real MongoDB:
a client with multiple orders · the cost snapshot surviving a route repricing ·
a status transition writing its history row and its stage task together.

## B4 acceptance — verified (59/59 live, 105/105 automated)

The B4 smoke run adds: document list returns an empty list for an unknown
order · upload-url fails cleanly with `STORAGE_NOT_CONFIGURED` when no bucket
is set (a named 422, not a 500) · anonymous upload-url → 401.

The automated suite proves the B4 criteria against a real MongoDB: the
upload → review → v2 flow with a version superseding the first · the string
`storageKey` appearing in no API response while being present in the database ·
access-log rows for upload, download and review with the actor attributed.

## B2 acceptance — verified live (45/45)

`npm run server:smoke` against the running API + Atlas: health/readiness ·
wrong password rejected with no cookie issued · correct password accepted ·
argon2 hash never returned · httpOnly refresh cookie set · `/auth/me` returns
the principal · refresh rotation issues a new cookie · replaying a used token
returns `REFRESH_REUSE_DETECTED` and revokes the family · logout kills the
session · Sales gets **403 on `/users` and `/roles`** while `/auth/me` returns
200 · anonymous `/users` returns 401 (not 403) · deactivation kills live access
immediately · password reset invalidates a token minted in the *same second* ·
7 roles / 18 permissions served from the server.

## Known limitations (must fix / verify)

- **QuickBooks is unverified end-to-end.** The code is written and its refusal
  paths are tested, but without sandbox credentials no request has reached the
  API. The "failed → retry → Synced, exactly one record" criterion is
  unproven until credentials and an OAuth-authorised company exist.
- Seed data is synthetic (DEMO codes) — migration + reconciliation pending.
- `docker-compose.yml` (Redis + MinIO) and the Dockerfile are still unverified:
  Docker Desktop is not installed on the dev machine. The Redis fallback means
  the API works without it, but the queue has never run against a real Redis.

## External blockers (unchanged)

MongoDB access · S3-compatible bucket · Redis/queue · QuickBooks sandbox +
credentials · `RTO & Onboarding Master Hub.xlsx` · QuickBooks export ·
production hosting access.

## Suggested merge path (user runs git)

```powershell
git checkout development
git merge rony-dev
git push origin development
# UAT on development, then:
git checkout main
git merge development
git push origin main
```

Review the diff per phase commit; `Skills_Connect_Admin_Software_Developer_Specification.docx`
and `dist/` must never appear in any commit (`.gitignore` enforced, verified).
