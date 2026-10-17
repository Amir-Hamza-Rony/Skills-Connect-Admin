# HANDOVER — Skills Connect Admin (Day 1–5 shell + Phase B2 backend)

Branch: `rony-dev`. Every module in the specification is built and working.
Phase B2 (Auth + RBAC) is complete: the API is live on MongoDB Atlas and the
front end signs in against it. Remaining phases are B3–B6 (see
`BACKEND-PLAN.md`).

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

## Still preview (B4+)

- Documents and tasks still read the in-memory preview store until B4 lands
  the storage adapter and signed URLs — a document row is only useful once
  there is a real file behind it.
- Invoices, payments, QuickBooks sync and the audit *viewer* still read
  `fin-store.ts`. They are async and REST-shaped, so pages do not change when
  the real endpoints land.

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

## Known preview limitations (must fix with backend)

- Clients/orders/documents/tasks/finance store is in-memory: reload resets; no
  multi-user persistence. (Users and roles are already on the real API.)
- QuickBooks transport is simulated; status/idempotency flow is real.
- Document versions record metadata only; bytes need signed-URL storage.
- Seed data is synthetic (DEMO codes) — migration + reconciliation pending.

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
