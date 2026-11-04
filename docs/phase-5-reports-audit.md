# Phase 5 — Reports & Analytics Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Baseline:** Phases 0–4 complete. Reports infrastructure partially implemented (11 server-side aggregation routes exist).

---

## Existing implementation status

### Report API routes (all `GET`, all `reports.view` permission)

| Route | Report | Aggregations | Filters |
|-------|--------|--------------|---------|
| `/reports/finance` | Headline finance | invoiced, collected, outstanding, overdue, pipeline | from/to dates |
| `/reports/revenue` | Revenue by qualification + agent | orders, revenue | qualificationId |
| `/reports/margin` | Margin by qualification | orders, revenue, cost, margin, percent | qualificationId |
| `/reports/ageing` | Overdue invoice ageing | count, amount per bucket | none |
| `/reports/collections` | Monthly collections | invoiced, collected, orders | none |
| `/reports/funnel` | Orders by workflow stage | count, percent per stage | none |
| `/reports/document-completion` | Document approval/rejection | total, approved, rejected, rates | none |
| `/reports/certificate-completion-time` | Certificate turnaround | avg/median/min/max days | none |
| `/reports/revenue-by-month` | Monthly invoiced vs collected | invoiced, collected, orders | none |
| `/reports/revenue-by-supplier` | Revenue by source agent + RTO | orders, revenue | none |
| `/reports/rto-turnaround` | RTO turnaround | (see route) | none |

**All aggregation is server-side** (MongoDB queries + in-JS grouping). All use `withAuth("reports.view")`. All support date-range `from`/`to` where applicable.

### Existing frontend
- `src/views/reports.tsx` — dashboard with KPI cards + report cards, consumes all 11 endpoints via `Promise.allSettled` (degraded gracefully).
- `src/lib/queues.ts` — client-side wrappers for revenueByMonth, revenueBySupplier, documentCompletion, certificateCompletionTime.

### Missing reports (Phase 5 requirements)

| Report | Description | Status |
|--------|-------------|--------|
| Client Report | Per-client: orders, invoiced, collected, outstanding, last order | Missing |
| Order Report | Per-order: status, value, payments, documents, workflow stage | Missing |
| Outstanding Receivables | Per-customer outstanding with ageing buckets | Missing |
| Supplier Cost / Payables | Supplier cost by qualification/RTO/route vs invoiced | Missing |
| Agent Commission | Per-agent: eligible deals, commission earned, paid/unpaid | Missing |
| Monthly Financial Summary | Monthly: invoiced, collected, outstanding, commission, costs | Partially (finance + collections split across endpoints) |

### Export — NOT IMPLEMENTED
No Excel or PDF export for any report. Required by Phase 5.

---

## Confirmed issues

### R-1 — No Client Report endpoint (High)

**Business impact:** Cannot view per-client financial and operational summary.

**Recommended solution:** `GET /api/reports/clients` — aggregate orders/invoices/payments per client with filters: date range, status, clientId. Returns per-client rows with invoiced/collected/outstanding.

**Priority:** High

### R-2 — No Order Report endpoint (High)

**Business impact:** Cannot view per-order detail with payments, documents, workflow status.

**Recommended solution:** `GET /api/reports/orders` — per-order rows with status, selling price, supplier cost, margin, payments allocated, document count, workflow stage. Filters: date range, status, clientId, qualificationId, rtoId.

**Priority:** High

### R-3 — No Outstanding Receivables Report (High)

**Business impact:** Cannot track per-customer overdue balances with ageing.

**Recommended solution:** `GET /api/reports/outstanding` — per-customer outstanding invoice balance with ageing buckets (1-30, 31-60, 61-90, 90+). Filters: date range, status, clientId.

**Priority:** High

### R-4 — No Supplier Cost / Payables Report (High)

**Business impact:** Cannot compare supplier cost snapshots vs client invoiced amounts (margin visibility).

**Recommended solution:** `GET /api/reports/supplier-costs` — per-qualification/RTO: supplier cost total, invoiced total, margin. Filters: date range, qualificationId, rtoId.

**Priority:** High

### R-5 — No Agent Commission Report (High)

**Business impact:** Cannot view per-agent commission earned vs paid.

**Recommended solution:** `GET /api/reports/agent-commission` — per-agent: eligible deal count, commission amount, paid amount, outstanding commission. Filters: date range, agentId, period.

**Priority:** High

### R-6 — No Monthly Financial Summary endpoint (Medium)

**Business impact:** No single endpoint combining invoiced, collected, outstanding, commission, supplier cost per month.

**Recommended solution:** `GET /api/reports/monthly-summary` — monthly rows with all financial metrics. Filters: date range.

**Priority:** Medium

### R-7 — No report export (High)

**Business impact:** Users cannot export reports to Excel or PDF for external sharing/archival.

**Recommended solution:** `GET /api/reports/[type]/export?format=xlsx\|pdf` — export filtered report data. Use `exceljs` for Excel, `pdfkit` for PDF. Protect against formula injection in Excel export.

**Priority:** High

---

## Multi-currency requirements

All report aggregations must:
- Group amounts by currency (never sum AUD + BDT together).
- Use stored `exchangeRate` snapshots from orders/payments/invoices for reporting-currency conversion.
- Never recalculate historical transactions using today's exchange rate.
- Clearly label currency in export output.

Existing `finance` report already sums all invoices/payments as raw numbers without currency separation — this is a pre-existing issue that Phase 5 report endpoints must avoid repeating.

---

## Implementation sequence

1. Add new report routes: clients, orders, outstanding, supplier-costs, agent-commission, monthly-summary.
2. Add export routes: `/reports/[type]/export` (xlsx + pdf).
3. Update frontend reports page with filter controls and export buttons.
4. Add tests for each report endpoint.
5. Verify multi-currency grouping correctness.
