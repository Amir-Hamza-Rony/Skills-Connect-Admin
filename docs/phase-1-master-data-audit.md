# Phase 1 — Master Data Management Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-03  
**Baseline:** Phase 0 complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 16 Phase 0 tests PASS.  
**Database:** `skills_connect_admin` is **completely empty** (zero collections, no seed data, no users, no roles, no master records).

---

## Existing implementation status

### Generic master CRUD (reusable)

| Route | Method | Auth | Collections | Status |
|-------|--------|------|-------------|--------|
| `GET /api/masters/[type]` | list | `qualifications.manage`/`rto.manage`/`agents.manage`/`pricing.manage` | `qualifications`, `rtos`, `agents`, `supplier-routes` | Implemented |
| `POST /api/masters/[type]` | create | same as above | same | Implemented (no validation, no dedupe) |
| `PATCH /api/masters/[type]/[id]` | update | same as above | same | Implemented (allows `_id`/`createdAt` mutation guarded only by key skip) |
| `POST /api/masters/supplier-routes/[id]/expire` | expire | `pricing.manage` | `supplier-routes` | Implemented |

Types exist in `src/lib/types.ts`: `Qualification`, `Rto`, `Agent`, `SupplierRoute`, `RoleName`, `Permission`.

### Frontend pages (reusable shells)

- `src/views/qualifications.tsx` — list + create + view dialog (licensing refs). No edit/deactivate detail page.
- `src/views/rtos.tsx` — list + create + view dialog. No edit/deactivate detail page.
- `src/views/agents.tsx` — list + create + activate/deactivate toggle. Single `type` enum (`sales_closing` \| `certificate_source` \| `rto_contact`). No edit dialog.
- `src/views/pricing.tsx` — supplier route list + create + expire. Immutable cost history.

Routes/pages already exist at `/qualifications`, `/rtos`, `/agents`, `/pricing` with `RequirePermission` guards.

### Missing functionality

| Area | Gap |
|------|-----|
| Qualification–RTO mapping | **No `qualification_rto_mappings` collection, no API route, no UI.** Required many-to-many. |
| Qualification detail/edit/deactivate | Only create/list/view dialog. No dedicated edit page or status toggle. |
| RTO detail/edit/deactivate | Only create/list/view dialog. No dedicated edit page or status toggle. |
| Agent edit | Only create/list/toggle active. No edit dialog. |
| Supplier route dedupe | No prevention of duplicate active routes (same qual+agent+RTO overlapping dates). |
| Master data validation | Generic create accepts any body; no field validation, no code/RTO-code duplicate checks. |
| Search/filter/pagination | None; generic `GET` returns whole collection unfiltered. |
| Database indexes | None on master collections. |
| Migration/seed scripts | None. DB is empty. |

### Existing relationships

- `SupplierRoute` references `qualificationId`, `sourceAgentId`, `rtoId` (all `ObjectId` strings stored as ObjectId in DB).
- Orders reference `qualificationId`, `sourceAgentId`, `rtoId`, `clientId` — master records must exist for referential integrity, but there is no enforcement today.
- No `qualification_rto_mappings` collection exists anywhere (confirmed via grep of `src/` and DB inspection).

### Agent model note

`Agent.type` is a single enum: `sales_closing` \| `certificate_source` \| `rto_contact`. The existing business model does **not** support multiple responsibilities per agent record. Per the rule "Do not create duplicate agent records simply because an agent has multiple roles" and "Do not introduce new business rules without evidence," I will **keep the single-type model** and support both Sales and Source agent types through existing values. Multi-responsibility per agent is not introduced in Phase 1.

---

## Confirmed issues & required schema changes

### M-1 — No Qualification–RTO mapping collection (Critical gap)

**Business impact:** Cannot express "one qualification available through multiple RTOs" / "one RTO provides multiple qualifications," which is a core Phase 1 requirement.

**Recommended solution:** Create `qualification_rto_mappings` collection with fields: `qualificationId`, `rtoId`, `status`, `effectiveFrom`, `effectiveTo`, `createdAt`, `updatedAt`. Unique compound index on `{qualificationId, rtoId}` to prevent duplicate mappings. Add API routes `GET/POST /api/masters/qualification-rto-mappings` and `PATCH/DELETE /api/masters/qualification-rto-mappings/[id]`.

**Priority:** Critical

### M-2 — Generic master create has no validation or duplicate prevention (High)

**Business impact:** Duplicate qualification codes, RTO codes, and agent records can be created; invalid data enters master collections.

**Recommended solution:** Add validation in create/update for required fields and uniqueness (qualification code, RTO code, agent name+contact). Return 409 on duplicate. Reuse for qualifications, rtos, agents.

**Priority:** High

### M-3 — No search/filter/pagination on master list endpoints (Medium)

**Business impact:** List endpoints return entire collections; unusable as data grows.

**Recommended solution:** Add `search`, `status`, `page`, `pageSize` query support to generic master GET (or per-type routes).

**Priority:** Medium

### M-4 — No database indexes on master collections (Medium)

**Business impact:** Queries on `qualificationId`, `rtoId`, `status`, `code` perform collection scans.

**Recommended solution:** Create indexes: `qualifications(code)`, `rtos(rtoCode)`, `agents(name)`, `supplier-routes(qualificationId, sourceAgentId, rtoId)`, `qualification_rto_mappings(qualificationId, rtoId)` unique.

**Priority:** Medium

---

## Migration considerations

- DB is empty → no existing records to preserve, no destructive migration risk.
- No seed data exists. A seed script may be added to bootstrap roles/users for local testing but must not be committed with real credentials.
- Migration scripts should be idempotent (safe to re-run) using upsert/create-index-if-not-exists patterns.
- Never delete records to resolve duplicates (none exist yet).

---

## Implementation plan

1. **Audit document** (this file).
2. **Qualification management** — improve generic create with validation/dedupe; add edit/deactivate; detail view.
3. **RTO management** — same as qualification.
4. **Qualification–RTO mapping** — new collection + routes + UI.
5. **Agent management** — edit dialog; keep single responsibility type.
6. **Supplier route management** — dedupe active routes; validate relationships.
7. **Migration scripts** — idempotent index creation; seed roles/users if needed.
8. **Frontend integration** — wire pages, nav, search/filter, permission guards.
9. **Tests** — CRUD, mapping, dedupe, permissions, invalid refs, inactive records.
10. **Verification** — typecheck, lint, build, test run.
