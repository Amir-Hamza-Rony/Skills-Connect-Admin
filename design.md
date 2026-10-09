# Skills Connect Admin — Design System (`design.md`)

> Source of truth: `Skills_Connect_Admin_Software_Developer_Specification.docx` (Sections 4, 12, 13, 18, 19).
> Status of this document: **Planned / design requirement**. No implementation is claimed unless verified in code.
> Current repository state (2026-10-09): project folder contains only the specification DOCX; no frontend/backend code, no theme system, no layout shell exists yet. Everything below is a **requirement**, not a description of existing UI.

## 1. Visual direction and principles

Serious business-management application for a business owner — premium, modern, professional enterprise admin, not a generic starter template.

Principles:

1. **Operational density with clarity** — tables and queues (Documents Missing, Payment Overdue, Ready for RTO) must be scannable; one primary action per row/screen.
2. **Single workspace per entity** — client profile is one operational workspace (header + financial summary + tabs), not scattered screens (Spec §19).
3. **Status legibility** — document, evidence, RTO-submission, certificate, payment, and order statuses are visually distinct and never collapsed into one generic badge (Spec §5–§6).
4. **Trust through consistency** — same page-heading, filter-bar, table, dialog, and badge patterns in every module (Clients, Orders, Qualifications, RTOs, Agents, Documents, Finance, Workflow, Reports, Settings, Audit).
5. **Progressive disclosure** — summary cards → tabs → drawers/dialogs → timeline; keep audit/history one click away but not in the way.

## 2. Typography, spacing, borders, radii, elevation, icons

- **Typography:** system-ui / Inter-style sans stack. Scale: page title ~20–24px/700, section title 15–16px/600, body 13–14px/400, meta/label 12px/500 uppercase-tracked for table headers and filter labels. Tabular numerals for all money, dates, and counts. Never use font size alone to convey status — always pair with badge text/icon.
- **Spacing:** 4px base. Page padding 24px desktop / 16px tablet / 12px mobile. Card padding 16–20px. Table row height ~48px. Filter bars wrap; actions right-aligned on desktop, stacked on mobile.
- **Borders:** 1px neutral border on cards, tables, dialogs, inputs. Dividers between client-profile tabs and timeline entries.
- **Radii:** inputs/buttons/badges 6–8px; cards/dialogs 10–12px; tables inherit card radius with clipped header. No pill-shaped primary buttons.
- **Elevation:** flat by default; level-1 shadow on cards, level-2 on dropdowns/popovers, level-3 on dialogs/drawers. No heavy shadows on data tables.
- **Icons:** single Lucide-style icon set via shadcn/ui. Fixed 16px in buttons/badges, 18–20px in nav. Every status badge has an icon + text (never color alone). Navigation sections (Dashboard, Clients, Orders, Qualifications, RTOs & Colleges, Agents, Documents, Finance, Workflow, Reports, Settings, Audit) each have a stable icon per Spec §18.

## 3. Color and semantic-token strategy

No hardcoded hex in components. All color flows through **semantic CSS variables / design tokens** so Light and Dark themes work on every component:

Tokens (names illustrative, values chosen at implementation):

- `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--card`, `--card-foreground`, `--popover`, `--border`, `--input`, `--ring`
- `--primary`, `--primary-foreground` (single brand action color)
- `--secondary`, `--accent` (navigation / hover states)
- `--success`, `--warning`, `--danger`, `--info` + their `-foreground` / `-muted` variants for status badges
- `--overdue` maps to `--danger`; `--outstanding` maps to `--warning`; `--paid/issued/approved` maps to `--success`

Status-color mapping (must remain readable in both themes, ≥ 4.5:1 for badge text):

| Concept | Examples | Token |
|---|---|---|
| Document | Requested, Received, Under Review, Approved, Rejected, Superseded | info → warning → success / danger |
| Evidence | Not Started, In Progress, Complete, Additional Evidence Required | muted → info → success / warning |
| RTO submission | Not Ready, Ready, Submitted, Acknowledged, Under Assessment, Additional Evidence Required, Issued | muted → info → success / warning |
| Certificate | Not Issued, Pending, Issued, File Received, Delivered | muted → warning → success |
| Payment / instalment | Unpaid, Part Paid, Paid, Overdue, Waived, Cancelled, Refunded, Written Off | muted → info → success / danger |
| Order groups | Sales / Onboarding / Submission / Assessment / Completion / Exception | distinct badge hues; Exception uses danger/warning |

Charts (revenue, collections, margin, turnaround) reuse the same tokens; never introduce chart-only colors.

## 4. Component library and Tailwind

- **shadcn/ui is the primary UI component library** (Button, Input, Select, Dialog, Sheet, DropdownMenu, Tabs, Table, Badge, Card, Calendar, Popover, Command, Tooltip, Separator, etc.).
- **Tailwind CSS** for layout and spacing, consistent with the planned stack. Utility classes reference the semantic tokens (e.g. `bg-background text-foreground border-border`), never raw palette values.
- Custom components are thin wrappers over shadcn/ui primitives so theme tokens propagate automatically.

## 5. Layout shell: sidebar, header, navigation

Spec §18 navigation must be implemented as:

- **Sidebar (desktop):** fixed left, full viewport height, two zones — static header/branding slot at top, independently scrolling nav below. Sections: Dashboard (Overview/Alerts/My Tasks), Clients, Orders, Qualifications, RTOs & Colleges, Agents, Documents, Finance, Workflow, Reports, Settings, Audit. Active route highlighted; badges show queue counts (e.g. Documents Under Review, Overdue).
- **Header (top bar):** fixed, contains breadcrumb, global search trigger, theme switcher (Light/Dark/System), user menu, and mobile drawer trigger. Page-specific actions live in the page heading, not the global header.
- **Breadcrumbs:** `Module / List / Record` (e.g. Clients / Imran Yasin / Order AUR32120). Always reflect the CLIENT → ORDER chain (Spec §24).
- **Page headings:** title + record identifier (client ID, invoice number, order ID) + status badges + primary/secondary actions. Filter bars sit directly under the heading with a consistent control order: search → status filters → agent/RTO/qualification filters → date range → saved views.
- **Cards:** KPI cards (sales, collected, outstanding, margin, overdue) with label, value (tabular), delta/context, and link to filtered list.
- **Data tables:** sticky header, sortable columns, row click → detail drawer or profile, inline status badges, pagination + total count, empty state with CTA (“No overdue instalments”), loading skeletons, error state with retry.
- **Forms:** labels above inputs, inline validation, disabled submit while invalid, destructive actions require confirmation dialog. Money inputs show AUD prefix and thousand separators; dates use calendar picker.
- **Dialogs/drawers:** create/edit client, new order, record payment, review document, retry QuickBooks sync — all as dialogs/drawers with explicit cancel/confirm and audit-visible actor.
- **Dropdowns/menus:** agent/RTO/qualification selectors show code + name (e.g. `AUR32120 — Certificate III…`); never a bare name when a code exists.
- **Charts:** revenue by month/agent/qualification/RTO, outstanding ageing, margin, orders by stage, document completion, certificate lead time (Spec §4K/§12). Loading and empty states required for every chart.

## 6. Role dashboards (Spec §12)

Same shell, different default widgets and queues:

- **Management:** active clients/orders, sales/collected/outstanding/margin, completed certificates, overdue.
- **Finance:** invoices due, overdue ageing, instalments due this week, collection rate, QuickBooks sync errors.
- **Operations:** evidence pending, documents rejected, RTO submissions, assessments, certificates pending.
- **Agent (Sales/Closing):** my clients/orders, payments, outstanding, documents needed, tasks due.
- **RTO/Sourcing:** orders by source agent/RTO, wholesale cost, turnaround time, provider performance.

Saved views required: Documents Missing, Payment Overdue, Ready for RTO, Under Assessment, Certificate Issued (Spec §13).

## 7. Authentication experience

- Dedicated centered login screen sharing the **same theme strategy** as the dashboard (no light-only login).
- Email + password (and refresh/session mechanism per `architecture.md`); generic error messages; keyboard-accessible; caps-lock/focus indicators; “remember theme, never credentials” in localStorage.
- Post-login redirect preserves intended route; session expiry returns to login with context message. No flash of wrong theme on login (see §9).

## 8. Module UI patterns (Spec §19–§20)

- **Client profile workspace:** header (legal/preferred name, client ID, phone, email, overall status) → financial summary strip (invoiced / paid / outstanding / overdue) → tabs: Orders | Documents | Payments | Invoices | Workflow timeline | Notes/Communications | Audit (authorised roles only).
- **Order detail:** qualification, selling price, supplier-cost snapshot, margin, sales agent / certificate-source agent / issuing RTO shown as three separate labeled fields (never merged), invoice/payment-plan links, document checklist status, workflow stage stepper (Sales → Onboarding → Submission → Assessment → Completion, plus On Hold/Cancelled/Refunded exception banner).
- **Document review:** checklist per order with per-document status, version history, reviewer, rejection reason, received/reviewed timestamps; approve/reject actions log actor + timestamp.
- **Invoices/payments:** invoice list with QuickBooks sync badge (Not Synced/Pending/Synced/Failed) + retry; payment-plan view (unlimited instalments with Pending/Due/Paid/Part Paid/Overdue/Waived/Cancelled); payment transactions with allocation, method, reference; balance/overdue computed, never hand-typed.
- **Audit history:** chronological timeline (actor, timestamp, before → after) for status, financial, document, and RTO-route changes; read-only; filterable by entity.

## 9. Mandatory theme behavior (non-negotiable)

1. Exactly three user-facing modes: **Light, Dark, System**. **System is the default for first-time users** (no stored preference).
2. Persist only the **non-sensitive theme preference** (`light | dark | system`) in `localStorage`. Never store tokens, PII, or credentials there.
3. When **System** is selected, react live to OS appearance changes (`prefers-color-scheme` listener).
4. **Avoid flash of wrong theme (FOUC/FOIT-theme):** inline blocking script in document `<head>` reads `localStorage` before first paint, falls back to `prefers-color-scheme`, and sets `class`/`data-theme` on `<html>`. Login page and dashboard use the **same script and token set**.
5. All components consume **semantic tokens / CSS variables**; both themes must be fully supported on every component including tables, charts, badges, dialogs, and login.
6. Theme switcher is in the header/user menu, accessible via keyboard, and announces changes to assistive tech.

Acceptance: cold load with stored `dark` shows dark on first paint; stored `system` follows OS and updates when OS changes without reload; login and app never disagree; no sensitive data in localStorage (verify via DevTools).

## 10. Mandatory independent scrolling (non-negotiable)

1. **Sidebar nav has its own vertical scroll container** (`overflow-y: auto`, fixed height = viewport minus header/branding).
2. **Main content has a separate scroll container**; the global `body` does not scroll the app shell on desktop.
3. Scrolling the sidebar **must not** move dashboard content; scrolling content **must not** move sidebar nav (independent `overflow` contexts, no scroll-chaining).
4. Header is fixed/sticky; sidebar is fixed; content scrolls beneath/within — define via flex/grid shell: `aside[fixed] + div[flex-col: header + main[overflow-y:auto]]`.
5. No accidental nested scrollbars: only the two intended vertical scroll regions; inner panels (tables, drawers) use constrained max-height scroll only when necessary.
6. No horizontal overflow: tables scroll internally (`overflow-x: auto` on table wrapper), page never scrolls sideways at 1280px+.
7. **Mobile/tablet:** sidebar becomes an overlay drawer (Sheet) with its own scroll; focus trap + Escape to close; content is the single scroll region.

Acceptance: wheel over sidebar scrolls only nav; wheel over content scrolls only content; no double scrollbars on desktop; drawer behaves correctly at ≤768px; passes keyboard scroll and 200%-zoom checks.

## 11. Accessibility and responsive

- Contrast ≥ 4.5:1 body text, visible focus rings on all interactive elements, full keyboard operation (nav, tables, dialogs, theme switcher), `aria-current` on active nav, live regions for sync/status updates, reduced-motion respect.
- Breakpoints: desktop ≥1024 (fixed sidebar + multi-column), tablet 768–1023 (collapsed/drawer sidebar, stacked cards), mobile <768 (drawer nav, single column, horizontally scrolling tables, stacked filter bars and financial summaries).

## 12. Current implementation vs requirement

- **Current:** none — no layout, theme, or module UI exists in this folder to verify. Do not treat this document as evidence of implementation.
- **Required next (Day 1):** scaffold app shell with §9 theme + §10 scrolling, placeholder navigation per §18, and loading/empty/error states before any business module is built.
