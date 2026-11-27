# Skills Connect Admin — Implementation Prompt

## Source Requirements
Combine both reference docs:
- `local-reference/Based on this, give me docs for the developer for....docx` (v5.1)
- `local-reference/Yes.docx` (v5.0)

Every item in these docs is a boss requirement. Organize the entire project cleanly around them.

## Current Stack
Next.js 16, React 19, TypeScript, Tailwind CSS, MongoDB, Vitest, oxlint.
Existing auth, RBAC, API routes, store layer, types, and 43 view pages are in place and must be adapted, not rewritten from scratch.

## Goal
Implement the full 5-portal RPL Partner & Broker SaaS per both docs:
- 6 roles: SUPER_ADMIN, OPS_ADMIN, ACCOUNTS, SALES_BDC, EXTERNAL_BROKER, CANDIDATE
- 5 isolated portals: /admin, /ops, /sales, /partner, /applicant
- 4-layer controlled pricing with immutable snapshots
- Candidate self-service portal (magic-link, 100-pt ID, USI, AVETMISS, evidence, certificate)
- Applications pipeline: DRAFT → RECEIVED → IN_PROGRESS → DELIVERED → ON_HOLD/CANCELLED
- Bidirectional qualification↔RTO sync with composite-key scopes
- Backend DTO serializer guard (never frontend-only hiding)
- Sidebar: 27 legacy → 9 menus with 301 redirects

## Execution Rules
1. Do NOT start implementing until the user reviews and returns prompt.md.
2. After each task is completed, run a testing step (lint, typecheck, or targeted vitest) before moving to the next task.
3. Follow existing code conventions: Tailwind classes, shadcn-style components in `src/components/ui/`, Next.js App Router route handlers in `src/app/api/`, store functions in `src/lib/store.ts`, types in `src/lib/types.ts`.
4. Never commit unless explicitly asked.
5. Keep field masking at the backend DTO/serializer layer — never rely solely on frontend UI hiding.

## Phases
Phase 1: Role & Portal Foundation
Phase 2: Candidate Portal (/applicant)
Phase 3: Applications Pipeline & Pricing
Phase 4: Qualifications, RTOs & Bidirectional Sync
Phase 5: Sidebar Consolidation & Ops/Finance
Phase 6: Testing & QA

## Validation Commands
- `npm run lint` — oxlint
- `npm run typecheck` — next typegen && tsc --noEmit
- `npm test` — vitest run

## Deliverable
Return this prompt.md to the user for review before execution begins.