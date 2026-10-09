# HANDOVER — Skills Connect Admin (Day 1–5 front-end shell)

Branch: `rony-dev`. Working preview of every module in the specification,
backed by an in-memory preview store shaped exactly like the future REST API.

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
14. Every mutation above appears in Audit Log with actor.
15. Finance totals reconcile across dashboard, reports, profile, order detail.

## Known preview limitations (must fix with backend)

- Store is in-memory: reload resets; no multi-user persistence.
- Preview auth accepts any password; session id in localStorage (backend:
  httpOnly short-lived + refresh rotation, server-side RBAC re-check).
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
