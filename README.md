# Skills Connect Admin

Admin & Client Management Software for Skills Connect — one client record,
many certificate orders, separated sales / certificate-source / issuing-RTO
relationships, documents, workflow, invoices, payment plans, payments,
QuickBooks sync, dashboards, reports, and audit.

> **Status:** Day 1–5 front-end shell complete on `rony-dev` with a preview
> in-memory store. The production backend (Node + Express + MongoDB) and the
> Excel/QuickBooks migration plug into the documented contracts in
> `architecture.md` / `workflow.md`.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript 6
- Tailwind CSS v4 + shadcn/ui (new-york) + Lucide icons
- next/navigation (file-based App Router)

## Quickstart

```powershell
npm install
npm run dev        # Next.js dev server on http://localhost:3000
npm run build      # production build (.next/)
npm run start      # serve the production build
npm run typecheck  # Next route types + tsc + server typecheck
npm run lint       # oxlint
```

## Demo accounts (preview auth — any password works)

| Email | Role |
|---|---|
| `admin@skillsconnect.example` | Super Admin (everything) |
| `finance@skillsconnect.example` | Finance |
| `operations@skillsconnect.example` | Operations |
| `sales@skillsconnect.example` | Sales / Closing Agent |
| `sourcing@skillsconnect.example` | RTO / Sourcing Manager |
| `review@skillsconnect.example` | Document Reviewer |

Preview data is synthetic (`DEMO` codes, `.example`/`.invalid` domains) and
resets on reload. Real data arrives via migration — see `HANDOVER.md`.

## Project layout

- `src/app/` — App Router routes (layouts, pages, providers, root theme script)
- `src/views/` — route screens (clients, orders, documents, finance, …)
- `src/components/` — shell, dashboard, ui primitives, dialogs, tables
- `src/lib/` — types, RBAC matrix, auth, theme, stores (API-shaped)
- `design.md` / `architecture.md` / `workflow.md` — source-of-truth docs

## Environment

Copy `.env.example` to `.env.local` when you need to override values. Never
commit secrets. Next.js inlines every `NEXT_PUBLIC_*` value into the browser
bundle at build time. `localStorage` holds only the non-sensitive theme
preference (`sc-theme`) and the sidebar collapse flag — never tokens or secrets.

## Deployment

Next.js runs as a normal Node server (`npm run build && npm run start`) or is
deployed natively to Vercel. Production deployment with backend, database
(MongoDB), and QuickBooks wiring follows `DEPLOYMENT.md` and `HANDOVER.md`.
