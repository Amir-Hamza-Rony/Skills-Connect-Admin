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

- React 19 + Vite 8 + TypeScript 6
- Tailwind CSS v4 + shadcn/ui (new-york) + Lucide icons
- react-router-dom (BrowserRouter, SPA fallback)

## Quickstart

```powershell
npm install
npm run dev      # local dev server
npm run build    # production build (dist/)
npm run preview  # serve the production build
npm run lint     # oxlint
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

- `src/pages/` — route screens (clients, orders, documents, finance, …)
- `src/components/` — shell, dashboard, ui primitives, dialogs, tables
- `src/lib/` — types, RBAC matrix, auth, theme, stores (API-shaped)
- `src/mocks/` — clearly-labeled preview seed data
- `design.md` / `architecture.md` / `workflow.md` — source-of-truth docs

## Environment

Copy `.env.example` to `.env` when backend variables exist. Never commit
`.env`. `localStorage` holds only the non-sensitive theme preference
(`sc-theme`) and the preview session id — never tokens or secrets.

## Deployment

Static hosting of `dist/` (any static host) serves the current shell.
`vite preview` already serves it with SPA fallback. Production deployment
with backend, database, object storage, and QuickBooks wiring follows
`HANDOVER.md`.
