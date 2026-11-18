# Phase 2 — Price List & Monthly Agent Commission Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-18  
**Baseline:** Phase 0 & Phase 1 complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 194 tests PASS.  
**Status:** Phase 2 fully implemented and committed (`4d79822 feat: complete phase 2 pricing and agent commission`).

---

## Scope determination

Phase 2 scope = Price List & Monthly Agent Commission, as defined in `docs/phase-2-pricing-commission-audit.md` (audit date 2026-11-03) and implemented per `docs/phase-2-implementation-report.md`. No scope was added or removed during implementation.

## Classification summary

| Area | Status | Evidence |
|------|--------|----------|
| Price categories CRUD (dedupe, status) | COMPLETE | `src/app/api/masters/price-categories/route.ts` + `[id]/route.ts` |
| Qualification price lists (CRUD, overlap prevention) | COMPLETE | `src/app/api/masters/price-lists/route.ts` + `[id]/route.ts` |
| Additional fees | COMPLETE | `src/app/api/masters/additional-fees/route.ts` |
| Order pricing snapshot integration | COMPLETE | `src/app/api/orders/route.ts` (POST captures snapshot) |
| Agent commission rules (CRUD, tiers, approval) | COMPLETE | `src/app/api/masters/commission-rules/route.ts` + `[id]/route.ts` |
| Monthly commission calculation | COMPLETE | `src/app/api/commission-records/route.ts` (action: calculate) |
| Commission approval / reject | COMPLETE | `.../[id]/approve/route.ts`, `.../[id]/reject/route.ts` |
| Commission payouts | COMPLETE | `src/app/api/commission-payouts/route.ts` |
| Permissions (`commissions.manage`, `commissions.view`) | COMPLETE | `src/lib/types.ts`, `ROUTE_PERMISSIONS` |
| Multi-currency (`Currency` union) | COMPLETE | `src/lib/types.ts` |
| New collections + indexes | COMPLETE | `scripts/migrate-master-data.mjs` |
| Frontend pages (6 views) | COMPLETE | `src/views/price-categories.tsx`, `price-lists.tsx`, `additional-fees.tsx`, `commission-rules.tsx`, `commission-records.tsx`, `commission-payouts.tsx` |
| Nav + server-side permission guards | COMPLETE | `src/components/layout/nav.ts` |
| Tests | COMPLETE | `tests/phase-2.test.ts` (17 tests) |
| Phase 1 regression | COMPLETE | `tests/phase-0.test.ts` + `tests/phase-1.test.ts` re-run |

## Existing functionality reused

- `withAuth`/`requirePermission` RBAC middleware (Phase 0).
- `writeAudit` audit helper (Phase 0).
- `collection`, `safeObjectId`, `getClient` db layer (Phases 0/1).
- `DataTable`, `Dialog`, `Badge`, `Button`, `Skeleton` UI components.
- `src/lib/store.ts` data-access layer extended with pricing/commission functions.
- `src/lib/master-validation.ts` + new `src/lib/pricing-validation.ts` validation layer.
- Existing `qualifications`, `agents`, `supplier-routes`, `orders` collections referenced (not duplicated).

## New collections introduced (Phase 2)

`price_categories`, `price_lists`, `additional_fees`, `agent_commission_rules`, `commission_records`, `commission_payouts`. None pre-existed. No `students` or `enrollments` collections created; `clients`/`orders` remain authoritative.

## Protected M0 helpers

`checkOrderAccess`, `getAccessibleClientIds`, `checkClientAccess`, `maskFinancialFields`, `filterOrdersByRole` remain intact. All 21 `OrderStatus` values and `ALLOWED_TRANSITIONS` preserved.

## Business rules requiring management approval (left unapproved/configurable)

Per confirmed requirements, deliberately not invented:
1. Exact order eligibility criteria (closure, payment collection, certificate issued).
2. Exclusion of cancelled/refunded orders.
3. Flat-per-deal vs incremental band tiers.
4. Commission currency vs multi-currency sale conversion and FX source.
5. Above-standard sale incentive criteria.
6. Which roles approve rules/payouts.

Example tiers (BDT 4,000 / 6,000 / 8,000 per deal) stored as draft/unapproved only, not activated as production rules.

## Known gaps / limitations (documented, not blocking)

- Real FX exchange-rate source not configured (placeholder rate = 1).
- Commission eligibility criteria not finalized; calculation uses `eligibleOrderStatuses: ["Completed"]` as configurable default.
- Reject commission record uses a direct `fetch` in frontend (store function `rejectCommissionRecord` not yet added) — functional but inconsistent with store pattern.
- No seed data for price categories/commission rules; created via UI per environment.
- Master-data mutation audit coverage present for pricing/commission routes but not extended to generic master routes.

## Security

- Server-side permission enforcement on all pricing/commission API routes.
- Frontend-only permission checks insufficient; enforced on server.
- Audit logging via `writeAudit` on all pricing/commission mutations.
- No secrets, password hashes, or tokens exposed in API responses or logs.
- No sensitive personal information leaked.
