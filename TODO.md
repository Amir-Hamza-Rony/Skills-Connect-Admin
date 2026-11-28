# Skills Connect Admin — Implementation To-Do List

## Source Requirements
- `local-reference/Based on this, give me docs for the developer for....docx` (v5.1)
- `local-reference/Yes.docx` (v5.0)
- Combined in `prompt.md`

## Validation Commands (run after each phase)
- `npm run lint` — oxlint (warnings OK, no errors)
- `npm run typecheck` — next typegen && tsc --noEmit
- `npm test` — vitest run (must pass all)

## Progress

### ✅ Phase 1 — Role & Portal Foundation (COMPLETED)
- Added performance deps: `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `bullmq`, `ioredis`
- `src/lib/types.ts` — 6 roles: SUPER_ADMIN, OPS_ADMIN, ACCOUNTS, SALES_BDC, EXTERNAL_BROKER, CANDIDATE (+ legacy aliases). Added `channelType` to User and Order types
- `src/lib/permissions.ts` — RBAC matrix with 6 roles, `ROLE_PORTAL` mapping, `ROUTE_PERMISSIONS`, `DEFAULT_VIEW_FOR`, `ALL_ROLES`, `resolvePrimaryRole`
- `src/lib/financial-visibility.ts` — 4-layer pricing visibility matrix per role
- `src/lib/dto-sanitizer.ts` — Backend DTO serializer stripping financial keys before JSON
- `src/lib/route-guard.ts` — Portal redirect logic (unauthorized portal → permitted portal)
- `src/components/require-auth.tsx` — Added `RequirePortal` component
- `src/middleware/auth.ts` — Added `channelType` to AuthUser
- `src/lib/api-auth.ts` — Added `channelType` to JWT payload verification
- `src/lib/api.ts` — Added `channelType` and `role` to client AuthUser
- `src/components/dashboard/role-dashboard.tsx` — Dashboard configs for all 6 roles
- Lint clean, typecheck clean, 377/377 tests pass

### ✅ Phase 2 — Candidate Portal (/applicant) (COMPLETED)
- `src/app/applicant/layout.tsx` — Portal layout with `RequirePortal` guard, sidebar navigation
- `src/app/applicant/page.tsx` — Dashboard with application list, ID points, next step
- `src/app/applicant/login/page.tsx` — Passwordless magic-link sign-in (request → sent → verified)
- `src/app/applicant/id-vault/page.tsx` — 100-Point ID counter (70/40/35/25/20 pts), progress bar, per-doc upload
- `src/app/applicant/usi/page.tsx` — USI verification (10-char), personal details, emergency contact, consent authority
- `src/app/applicant/avetmiss/page.tsx` — 5-step form: Course/Delivery → Personal/USI → Demographics → RPL Evidence → Policies/E-Signature
- `src/app/applicant/evidence/page.tsx` — 6 evidence types with status pills, required/optional markers
- `src/app/applicant/certificate/page.tsx` — Certificate download when DELIVERED, B2B candidate isolation (hides pricing)
- API: `src/app/api/auth/magic-link/request/route.ts`, `src/app/api/auth/magic-link/verify/route.ts`
- UI components: `src/components/ui/input.tsx`, `src/components/ui/label.tsx`
- Lint clean, typecheck clean, 377/377 tests pass

### ✅ Phase 3 — Applications Pipeline & Pricing (COMPLETED)
- `src/lib/types.ts` — Application statuses: DRAFT → RECEIVED → IN_PROGRESS → DELIVERED → ON_HOLD/CANCELLED. Added 4-layer pricing fields (trueRtoCost, approvedInternalCost, b2bWholesalePrice, b2cRetailPrice + snapshots)
- `src/app/api/orders/[id]/status/route.ts` — New transition rules + immutable price snapshots on RECEIVED + mandatory reason note for ON_HOLD/CANCELLED
- `src/app/api/orders/route.ts` — Returns 4-layer pricing fields, accepts pricing fields on create, DRAFT default status
- `src/app/api/applications/level-1/route.ts` — Level 1 Quick Lead Intake (DRAFT) with magic-link trigger, RTO enrolment kit auto-attach
- `src/app/api/applications/level-2/route.ts` — PATCH to save 5-step AVETMISS data per step
- `src/lib/audit.ts` — Added `snapshots` field to AuditInput
- Tests updated for new channel types (IN_HOUSE_B2C/EXTERNAL_B2B) and new statuses
- Lint clean, typecheck clean, 377/377 tests pass

---

## ✅ Phase 4 — Qualifications, RTOs & Bidirectional Sync (COMPLETED)
- `rto_qualification_scopes` composite key: qualification_id + intermediary_partner_id + issuing_rto_id + delivery_mode → true_rto_cost
- Delivery modes: RPL / ONLINE / CLASSROOM variants per qualification
- Bundles: `is_bundle = true` for dual qualifications (e.g., CHC33021 + CHC43121)
- Training package tags: CHC, AUR, BSB, CPC, CPP, HLT, ICT, FNS, TLI, SIS
- RTO-specific enrolment kits: PDF/DOCX per (issuing_rto_id, qualification_id) pair
- API: GET/POST /api/scopes, GET/POST /api/qualifications/:id/scopes, GET/POST /api/enrolment-kits
- Lint clean, typecheck clean, 377/377 tests pass

## ✅ Phase 5 — Sidebar Consolidation & Ops/Finance (COMPLETED)
- Refactored 27 legacy sidebar items → 9 grouped menus with 301/router redirects from legacy paths
- Sidebar sections: Overview/Dashboard, Operations/Candidates & Applications, Provider Module/Qualifications, Provider Module/RTOs & Partners, Sales & Channels/In-House Sales Team & External Agents, Pricing & Finance/Pricing, Pricing & Finance/Finance & Payouts, Settings/System & Settings
- Ops Admin: Documents, Workflow, RTO Processing, Certificate Deliveries (existing)
- Accounts: Finance page with B2B/B2C invoicing, payment reconciliation, QuickBooks sync (existing)
- BDC commission ledger (margin vs Approved Internal Cost) — new view at /finance/bdc-commission-ledger
- External broker assigned fixed wholesale tiers — new view at /partner/external-agents
- Lint clean, typecheck clean, 377/377 tests pass

## ⏳ Phase 6 — Testing & QA (PENDING)
Tasks:
- Route guard penetration testing (unauthorized URL navigation redirects to permitted portal)
- Payload inspection (zero margin leakage: true_rto_cost absent from JSON under SALES_BDC/EXTERNAL_BROKER)
- B2B candidate isolation (channel_type EXTERNAL_B2B → zero pricing/invoice tabs in /applicant)
- 100-Point ID gate (RECEIVED blocked when id_points_verified < 100; returning candidate inherits verified USI + ID docs)
- Immutable snapshot verification (editing master prices doesn't alter RECEIVED/IN_PROGRESS/DELIVERED figures)

---

## How to Resume
1. Open terminal in `C:\Skills-Connect-Admin`
2. Read `prompt.md` for the full implementation prompt
3. Run `npm run lint`, `npm run typecheck`, `npm test` to verify current state
4. Continue with Phase 4 (Qualifications, RTOs & Bidirectional Sync)
5. After each task, run lint + typecheck + tests before moving to the next

## Key Files
- `prompt.md` — Full implementation prompt (review before executing)
- `src/lib/types.ts` — Core types (roles, order, pricing fields, statuses)
- `src/lib/permissions.ts` — RBAC matrix + portal mapping
- `src/lib/financial-visibility.ts` — 4-layer pricing visibility
- `src/lib/dto-sanitizer.ts` — Backend field stripping
- `src/lib/route-guard.ts` — Portal redirect logic
- `src/app/applicant/` — Candidate portal pages
- `src/app/api/orders/` — Order API with pipeline + pricing
- `src/app/api/applications/` — Level 1 & Level 2 application API
