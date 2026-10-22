import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import {
  certificateCompletionTime,
  documentCompletion,
  revenueByMonth,
  revenueBySupplier,
  type CertificateCompletionTime,
  type DocumentCompletionRow,
  type RevenueByMonthRow,
  type RevenueBySupplierGroup,
} from "@/lib/queues"

const aud = (n: number) => `AUD ${n.toLocaleString("en-AU")}`

interface FinanceReport {
  orders: number
  clients: number
  invoiced: number
  collected: number
  outstanding: number
  overdueAmount: number
  overdueCount: number
  pipelineValue: number
}

interface NameValue {
  name: string
  orders: number
  revenue: number
}

interface MarginRow {
  name: string
  orders: number
  revenue: number
  cost: number
  margin: number
  percent: number
}

interface FunnelRow {
  stage: string
  count: number
  percent: number
}

interface AgeingBucket {
  label: string
  count: number
  amount: number
}

interface CollectionsMonth {
  month: string
  orders: number
  invoiced: number
  collected: number
}

/**
 * Day-4 operational reports (Spec §4K): revenue, ageing, margin, funnel.
 *
 * CUTOVER STATE (B6): the aggregations moved server-side. This page used to
 * pull every order, client, qualification, agent and invoice and group them in
 * the browser, which meant the numbers on screen came from a different code
 * path than the dashboard — so a report could disagree with the dashboard and
 * neither could be proven wrong. The server now derives them once.
 */
export function ReportsPage() {
  const [finance, setFinance] = useState<FinanceReport | null>(null)
  const [revenue, setRevenue] = useState<{ byQualification: NameValue[]; byAgent: NameValue[] } | null>(null)
  const [margin, setMargin] = useState<{ totals: MarginRow; byQualification: MarginRow[] } | null>(null)
  const [funnel, setFunnel] = useState<{ total: number; byStage: FunnelRow[]; conversionPercent: number } | null>(null)
  const [ageing, setAgeing] = useState<{ totalOverdue: number; buckets: AgeingBucket[] } | null>(null)
  const [collections, setCollections] = useState<CollectionsMonth[] | null>(null)
  const [revMonth, setRevMonth] = useState<RevenueByMonthRow[] | null>(null)
  const [revSupplier, setRevSupplier] = useState<{
    bySourceAgent: RevenueBySupplierGroup[]
    byRto: RevenueBySupplierGroup[]
  } | null>(null)
  const [docCompletion, setDocCompletion] = useState<DocumentCompletionRow[] | null>(null)
  const [certTime, setCertTime] = useState<CertificateCompletionTime | null>(null)

  useEffect(() => {
    void (async () => {
      // allSettled (not all) so one failing report can never leave the page
      // stuck on the loading skeleton — every section degrades independently.
      const [fin, rev, marg, fun, age, col, rm, rs, dc, ct] = await Promise.allSettled([
        api.get<FinanceReport>("/reports/finance"),
        api.get<{ byQualification: NameValue[]; byAgent: NameValue[] }>("/reports/revenue"),
        api.get<{ totals: MarginRow; byQualification: MarginRow[] }>("/reports/margin"),
        api.get<{ total: number; byStage: FunnelRow[]; conversionPercent: number }>("/reports/funnel"),
        api.get<{ totalOverdue: number; buckets: AgeingBucket[] }>("/reports/ageing"),
        api.get<{ months: CollectionsMonth[] }>("/reports/collections"),
        revenueByMonth(),
        revenueBySupplier(),
        documentCompletion(),
        certificateCompletionTime(),
      ])
      const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === "fulfilled" ? r.value : fallback
      setFinance(val(fin, { orders: 0, clients: 0, invoiced: 0, collected: 0, outstanding: 0, overdueAmount: 0, overdueCount: 0, pipelineValue: 0 }))
      setRevenue(val(rev, { byQualification: [], byAgent: [] }))
      setMargin(val(marg, { totals: { name: "", orders: 0, revenue: 0, cost: 0, margin: 0, percent: 0 }, byQualification: [] }))
      setFunnel(val(fun, { total: 0, byStage: [], conversionPercent: 0 }))
      setAgeing(val(age, { totalOverdue: 0, buckets: [] }))
      setCollections(val(col, { months: [] }).months)
      setRevMonth(val(rm, { months: [] }).months)
      setRevSupplier(val(rs, { bySourceAgent: [], byRto: [] }))
      setDocCompletion(val(dc, { byType: [] }).byType)
      setCertTime(val(ct, { count: 0, averageDays: 0, medianDays: 0, minDays: 0, maxDays: 0 }))
    })()
  }, [])

  if (
    !finance || !revenue || !margin || !funnel || !ageing || !collections ||
    !revMonth || !revSupplier || !docCompletion || !certTime
  ) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading reports" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Reports</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Revenue, collections, margin, pipeline · {finance.orders} orders · {finance.clients} clients
          </p>
        </div>
        <Badge variant="success">Live data</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pipeline value" value={aud(finance.pipelineValue)} />
        <StatCard label="Invoiced" value={aud(finance.invoiced)} />
        <StatCard label="Collected" value={aud(finance.collected)} />
        <StatCard
          label="Overdue"
          value={aud(finance.overdueAmount)}
          detail={`${finance.overdueCount} invoice${finance.overdueCount === 1 ? "" : "s"}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Revenue by qualification">
          <Rows
            rows={revenue.byQualification.map((r) => ({
              label: r.name,
              detail: `${r.orders} order${r.orders === 1 ? "" : "s"}`,
              value: aud(r.revenue),
            }))}
          />
        </ReportCard>

        <ReportCard title="Agent performance (sales)">
          <Rows
            rows={revenue.byAgent.map((r) => ({
              label: r.name,
              detail: `${r.orders} order${r.orders === 1 ? "" : "s"}`,
              value: aud(r.revenue),
            }))}
          />
        </ReportCard>

        <ReportCard title="Margin by qualification">
          <Rows
            rows={margin.byQualification.map((r) => ({
              label: r.name,
              detail: `${r.percent}% margin · ${r.orders} order${r.orders === 1 ? "" : "s"}`,
              value: aud(r.margin),
            }))}
          />
        </ReportCard>

        <ReportCard title="Collections by month">
          <Rows
            rows={collections.map((m) => ({
              label: m.month,
              detail: `${m.orders} order${m.orders === 1 ? "" : "s"}`,
              value: `${aud(m.collected)} of ${aud(m.invoiced)}`,
            }))}
          />
        </ReportCard>

        <ReportCard title="Orders by workflow stage">
          <Rows
            rows={funnel.byStage.map((s) => ({
              label: s.stage,
              detail: `${s.percent}%`,
              value: String(s.count),
            }))}
          />
        </ReportCard>

        <ReportCard
          title="Overdue ageing"
          subtitle={`${aud(ageing.totalOverdue)} overdue`}
        >
          <Rows
            rows={ageing.buckets.map((b) => ({
              label: b.label,
              detail: `${b.count} invoice${b.count === 1 ? "" : "s"}`,
              value: aud(b.amount),
            }))}
          />
        </ReportCard>

        <ReportCard title="Revenue by month" subtitle="Invoiced vs collected">
          <Rows
            rows={revMonth.map((m) => ({
              label: m.month,
              detail: `${m.orders} order${m.orders === 1 ? "" : "s"}`,
              value: `${aud(m.collected)} of ${aud(m.invoiced)}`,
            }))}
          />
        </ReportCard>

        <ReportCard title="Revenue by source agent">
          <Rows
            rows={revSupplier.bySourceAgent.map((r) => ({
              label: r.name,
              detail: `${r.orders} order${r.orders === 1 ? "" : "s"}`,
              value: aud(r.revenue),
            }))}
          />
        </ReportCard>

        <ReportCard title="Revenue by RTO">
          <Rows
            rows={revSupplier.byRto.map((r) => ({
              label: r.name,
              detail: `${r.orders} order${r.orders === 1 ? "" : "s"}`,
              value: aud(r.revenue),
            }))}
          />
        </ReportCard>

        <ReportCard title="Document completion" subtitle="Approval & rejection by type">
          <Rows
            rows={docCompletion.map((d) => ({
              label: d.type,
              detail: `${d.approvalRate}% approved · ${d.rejectionRate}% rejected of ${d.total}`,
              value: `${d.approved} / ${d.total}`,
            }))}
          />
        </ReportCard>

        <ReportCard
          title="Certificate completion time"
          subtitle={`Order → certificate delivered${certTime.count ? ` · ${certTime.count} samples` : ""}`}
        >
          <Rows
            rows={
              certTime.count === 0
                ? []
                : [
                    { label: "Average", detail: "Mean days", value: `${certTime.averageDays}d` },
                    { label: "Median", detail: "Middle sample", value: `${certTime.medianDays}d` },
                    { label: "Fastest", detail: "Minimum days", value: `${certTime.minDays}d` },
                    { label: "Slowest", detail: "Maximum days", value: `${certTime.maxDays}d` },
                  ]
            }
          />
        </ReportCard>
      </div>

      <p className="text-xs text-muted-foreground">
        {funnel.conversionPercent}% of orders reach Completed. Figures are computed
        server-side from the same rows the dashboard reads.
      </p>
    </div>
  )
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

function ReportCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="pb-3 text-sm font-semibold">{title}</h2>
      {subtitle ? <p className="pb-2 text-xs text-muted-foreground">{subtitle}</p> : null}
      {children}
    </div>
  )
}

function Rows({ rows }: { rows: Array<{ label: string; detail: string; value: string }> }) {
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">No data in scope.</p>
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{r.label}</span>
            {r.detail ? <span className="block text-xs text-muted-foreground">{r.detail}</span> : null}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{r.value}</span>
        </li>
      ))}
    </ul>
  )
}
