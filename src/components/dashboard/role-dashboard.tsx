"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  BarChart3,
  ClipboardList,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react"

import { BarChart, ChartFrame, DonutChart, LineChart } from "@/components/dashboard/charts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import {
  getDashboardData,
  type DashboardData,
  type DashboardFilters,
  type DashboardKpi,
} from "@/lib/dashboard"
import { resolvePrimaryRole } from "@/lib/permissions"
import type { RoleName } from "@/lib/types"

type TabId = "overview" | "clients" | "orders" | "payments" | "performance" | "analytics"

interface RoleConfig {
  title: string
  subtitle: string
  tabs: TabId[]
  sections: string[]
}

/**
 * Dashboard configuration for all roles (docs v5.1 §1, v5.0 §1).
 * 6 roles: SUPER_ADMIN, OPS_ADMIN, ACCOUNTS, SALES_BDC, EXTERNAL_BROKER, CANDIDATE
 * plus legacy aliases: ADMIN, BDC, B2B_AGENT, EMPLOYEE
 */
const CONFIG: Record<RoleName, RoleConfig> = {
  SUPER_ADMIN: {
    title: "Executive overview",
    subtitle: "Whole-of-business performance, finance, commission and delivery",
    tabs: ["overview", "clients", "orders", "payments", "performance", "analytics"],
    sections: ["overview", "pipeline", "finance", "commission"],
  },
  OPS_ADMIN: {
    title: "Operations centre",
    subtitle: "Applications, 100-point ID verification, RTO lodgement and certificate delivery",
    tabs: ["overview", "clients", "orders", "payments"],
    sections: ["overview", "pipeline"],
  },
  ACCOUNTS: {
    title: "Finance & payouts",
    subtitle: "B2B/B2C invoicing, payment reconciliation, RTO bills, QuickBooks sync",
    tabs: ["overview", "clients", "orders", "payments"],
    sections: ["overview", "finance"],
  },
  SALES_BDC: {
    title: "My assignments",
    subtitle: "Assigned clients and orders, processing stage and follow-ups",
    tabs: ["overview", "clients", "orders", "analytics"],
    sections: ["overview", "pipeline"],
  },
  EXTERNAL_BROKER: {
    title: "Partner overview",
    subtitle: "Assigned orders, certificate progress and wholesale pricing",
    tabs: ["overview", "clients", "orders"],
    sections: ["overview", "pipeline"],
  },
  CANDIDATE: {
    title: "Applicant portal",
    subtitle: "Your application status, evidence uploads and certificate download",
    tabs: ["overview"],
    sections: ["overview"],
  },
  ADMIN: {
    title: "Operations centre",
    subtitle: "Clients, orders, documents, payments and processing queues",
    tabs: ["overview", "clients", "orders", "payments", "performance"],
    sections: ["overview", "pipeline", "finance"],
  },
  BDC: {
    title: "My assignments",
    subtitle: "Assigned clients and orders, processing stage and follow-ups",
    tabs: ["overview", "clients", "orders", "analytics"],
    sections: ["overview", "pipeline"],
  },
  B2B_AGENT: {
    title: "Partner overview",
    subtitle: "Assigned orders, certificate progress and sourcing performance",
    tabs: ["overview", "clients", "orders"],
    sections: ["overview", "pipeline"],
  },
  EMPLOYEE: {
    title: "Employee portal",
    subtitle: "Assigned tasks and orders",
    tabs: ["overview"],
    sections: ["overview"],
  },
}

const TAB_LABELS: Record<TabId, string> = {
  overview: "Overview",
  clients: "Client Tracking",
  orders: "Order Pipeline",
  payments: "Payments & Invoices",
  performance: "Performance",
  analytics: "Analytics",
}

const TAB_ICONS = {
  overview: LayoutDashboard,
  clients: Users,
  orders: ClipboardList,
  payments: Wallet,
  performance: BarChart3,
  analytics: ShieldCheck,
}

const inputCls =
  "h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-emerald-500"

function formatValue(kpi: DashboardKpi): string {
  if (kpi.value === null || kpi.value === undefined) return "Unavailable"
  if (kpi.unit === "money") {
    const value = Number(kpi.value)
    if (!Number.isFinite(value)) return "Unavailable"
    if (!kpi.currency) return value.toLocaleString()
    try {
      return new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: kpi.currency,
        maximumFractionDigits: 0,
      }).format(value)
    } catch {
      return `${kpi.currency} ${value.toLocaleString()}`
    }
  }
  if (kpi.unit === "percent") return `${kpi.value}%`
  return String(kpi.value)
}

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-500">—</span>
  const v = value.toLowerCase()
  const tone = v.includes("cancel") || v.includes("reject") || v.includes("fail") || v.includes("missing")
    ? "bg-rose-500/15 text-rose-300"
    : v.includes("complete") || v.includes("deliver") || v.includes("approve") || v.includes("paid") || v.includes("issued")
      ? "bg-emerald-500/15 text-emerald-300"
      : v.includes("await") || v.includes("pending") || v.includes("under") || v.includes("review")
        ? "bg-amber-500/15 text-amber-300"
        : "bg-slate-700/60 text-slate-300"
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{value}</span>
}

function KpiTile({ kpi }: { kpi: DashboardKpi }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition-colors hover:border-emerald-500/40">
      <p className="truncate text-xs text-slate-400">{kpi.label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-emerald-300">{formatValue(kpi)}</p>
      <p className="mt-1 truncate text-[11px] text-slate-500">{kpi.caption}</p>
    </div>
  )
}

function Section({ title, kpis }: { title: string; kpis: DashboardKpi[] }) {
  if (!kpis.length) return null
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {kpis.map((k) => <KpiTile key={k.id} kpi={k} />)}
      </div>
    </section>
  )
}

function Unavailable({ title, reason }: { title: string; reason?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{reason ?? "This section is not available."}</p>
    </div>
  )
}

function TablePanel({ title, children, count }: { title: string; children: React.ReactNode; count: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <Badge variant="secondary">{count}</Badge>
      </div>
      {count === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">No records match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  )
}

const th = "whitespace-nowrap px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400"
const td = "whitespace-nowrap px-4 py-2.5 text-xs text-slate-300"

export function RoleDashboard() {
  const { user, authLoading } = useAuth()
  const role = useMemo(() => resolvePrimaryRole({ roleNames: user?.roleNames }), [user])
  const config = role ? CONFIG[role] : null

  const [tab, setTab] = useState<TabId>("overview")
  const [filters, setFilters] = useState<DashboardFilters>({ period: "year" })
  const [draft, setDraft] = useState<DashboardFilters>({ period: "year" })
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const filterKey = JSON.stringify(filters)

  const load = useCallback(async () => {
    if (!role) return
    setLoading(true)
    setError(null)
    try {
      setData(await getDashboardData(filters))
    } catch (err: any) {
      setError(err?.message ?? "Dashboard data could not be loaded.")
      setData(null)
    } finally {
      setLoading(false)
    }
    // filterKey is the stable serialisation of `filters`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, filterKey, reloadKey])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (config && !config.tabs.includes(tab)) setTab(config.tabs[0])
  }, [config, tab])

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    )
  }

  if (!role || !config) {
    return (
      <div className="mx-auto w-full max-w-7xl p-6">
        <Unavailable title="No dashboard available" reason="This account has no supported role." />
      </div>
    )
  }

  const charts = data?.charts
  const statusOptions = charts?.statusDistribution.map((s) => s.status) ?? []
  const agentOptions = charts?.agentPerformance ?? []

  const applyFilters = () => {
    setFilters({ ...draft })
    setTab("overview")
  }

  const resetFilters = () => {
    const next: DashboardFilters = { period: "year" }
    setDraft(next)
    setFilters(next)
  }

  const renderOverview = () => (
    <div className="space-y-6">
      {config.sections.map((section) => {
        if (section === "finance" && !data?.availability.finance.available) {
          return <Unavailable key={section} title="Financial analytics" reason={data?.availability.finance.reason} />
        }
        if (section === "commission" && !data?.availability.commission.available) {
          return <Unavailable key={section} title="Commission analytics" reason={data?.availability.commission.reason} />
        }
        return <Section key={section} title={section[0].toUpperCase() + section.slice(1)} kpis={data?.kpis[section] ?? []} />
      })}

      {data && !data.availability.charts.available ? (
        <Unavailable title="Charts" reason={data.availability.charts.reason} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartFrame title="Orders over time" caption="Monthly order creation in scope">
            <LineChart data={charts?.ordersOverTime ?? []} />
          </ChartFrame>
          <ChartFrame title="Order status distribution" caption="All 21 statuses are preserved">
            <BarChart data={charts?.statusDistribution ?? []} labelKey="status" valueKey="count" />
          </ChartFrame>
          <ChartFrame title="Qualification mix" caption="Orders by qualification">
            <DonutChart data={charts?.qualificationDistribution ?? []} />
          </ChartFrame>
          <ChartFrame title="RTO processing progress" caption="Submission status across scoped orders">
            <BarChart data={charts?.rtoProgress ?? []} labelKey="stage" valueKey="count" />
          </ChartFrame>
        </div>
      )}
    </div>
  )

  const renderClients = () => (
    <TablePanel title="Client tracking" count={data?.tables.clients.length ?? 0}>
      <table className="w-full min-w-[720px]">
        <thead className="border-b border-slate-800"><tr>
          <th className={th}>Client</th><th className={th}>Status</th><th className={th}>Orders</th>
          <th className={th}>Missing docs</th><th className={th}>Qualification</th><th className={th}>Contact</th>
        </tr></thead>
        <tbody>
          {(data?.tables.clients ?? []).map((c) => (
            <tr key={c.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
              <td className={td}>{c.name}</td>
              <td className={td}><StatusBadge value={c.status} /></td>
              <td className={td}>{c.orderCount}</td>
              <td className={td}>{c.missingDocuments > 0 ? <span className="text-rose-300">{c.missingDocuments} missing</span> : <span className="text-emerald-300">Complete</span>}</td>
              <td className={td}>{c.qualification ?? "—"}</td>
              <td className={td}>{c.email ?? c.phone ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TablePanel>
  )

  const renderOrders = () => (
    <TablePanel title="Order pipeline" count={data?.tables.orders.length ?? 0}>
      <table className="w-full min-w-[900px]">
        <thead className="border-b border-slate-800"><tr>
          <th className={th}>Order</th><th className={th}>Client</th><th className={th}>Qualification</th>
          <th className={th}>Status</th><th className={th}>RTO</th><th className={th}>Evidence</th>
          <th className={th}>Certificate</th>{data?.tables.orders.some((o) => o.amount !== undefined) && <th className={th}>Amount</th>}
        </tr></thead>
        <tbody>
          {(data?.tables.orders ?? []).map((o) => (
            <tr key={o.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
              <td className={td}><span className="font-mono text-[11px] text-slate-400">{o.id.slice(0, 8)}</span></td>
              <td className={td}>{o.client}</td>
              <td className={td}>{o.qualification}</td>
              <td className={td}><StatusBadge value={o.status} /></td>
              <td className={td}>{o.rto}</td>
              <td className={td}><StatusBadge value={o.evidenceStatus} /></td>
              <td className={td}><StatusBadge value={o.certificateStatus} /></td>
              {o.amount !== undefined && (
                <td className={td}>
                  {new Intl.NumberFormat("en-AU", { style: "currency", currency: o.currency ?? "AUD", maximumFractionDigits: 0 }).format(o.amount)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TablePanel>
  )

  const renderPayments = () => {
    if (!data?.availability.finance.available) {
      return <Unavailable title="Payments & invoices" reason={data?.availability.finance.reason} />
    }
    return (
      <div className="space-y-5">
        <Section title="Invoiced, collected and outstanding by currency" kpis={data.kpis.finance ?? []} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(data.currencyTotals ?? []).map((c) => (
            <div key={c.currency} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">{c.currency} balance</p>
              <p className="mt-2 text-lg font-semibold text-emerald-300">{formatValue({ id: c.currency, label: c.currency, caption: "", value: c.outstanding, unit: "money", currency: c.currency })}</p>
              <p className="mt-1 text-[11px] text-slate-500">Overdue: {formatValue({ id: `o-${c.currency}`, label: "", caption: "", value: c.overdue, unit: "money", currency: c.currency })}</p>
            </div>
          ))}
          {!data.currencyTotals.length && <Unavailable title="No finance records" reason="No invoices or payments are available in scope." />}
        </div>
        <TablePanel title="Invoices" count={data.tables.invoices.length}>
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-slate-800"><tr>
              <th className={th}>Invoice</th><th className={th}>Client</th><th className={th}>Status</th>
              <th className={th}>Due</th><th className={th}>Total</th>
            </tr></thead>
            <tbody>
              {data.tables.invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                  <td className={td}>{inv.invoiceNumber}</td>
                  <td className={td}>{inv.client}</td>
                  <td className={td}><StatusBadge value={inv.status} /></td>
                  <td className={td}>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}</td>
                  <td className={td}>{formatValue({ id: inv.id, label: "", caption: "", value: inv.total, unit: "money", currency: inv.currency })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablePanel>
      </div>
    )
  }

  const renderPerformance = () => (
    <div className="space-y-5">
      <Section title="Processing pipeline" kpis={data?.kpis.pipeline ?? []} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="Agent performance" caption="Orders handled per responsibility (sales, source, RTO contact)">
          <BarChart data={charts?.agentPerformance ?? []} labelKey="name" valueKey="orders" />
        </ChartFrame>
        <ChartFrame title="RTO progress" caption="Current submission stage">
          <BarChart data={charts?.rtoProgress ?? []} labelKey="stage" valueKey="count" />
        </ChartFrame>
      </div>
    </div>
  )

  const renderAnalytics = () => (
    <div className="space-y-5">
      <Section title="Overview metrics" kpis={data?.kpis.overview ?? []} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="Pipeline value over time" caption="Order selling prices by month, grouped by currency — not invoiced or collected revenue; no conversion is applied">
          <LineChart data={charts?.revenueOverTime ?? []} valueKey="amount" seriesKey="currency" />
        </ChartFrame>
        <ChartFrame title="Commission trend" caption="Approved or paid records only">
          <LineChart data={charts?.commissionTrend ?? []} valueKey="amount" seriesKey="currency" />
        </ChartFrame>
        <ChartFrame title="Orders over time">
          <LineChart data={charts?.ordersOverTime ?? []} />
        </ChartFrame>
        <ChartFrame title="Qualification mix">
          <DonutChart data={charts?.qualificationDistribution ?? []} />
        </ChartFrame>
      </div>
    </div>
  )

  const renderTab = () => {
    switch (tab) {
      case "clients": return renderClients()
      case "orders": return renderOrders()
      case "payments": return renderPayments()
      case "performance": return renderPerformance()
      case "analytics": return renderAnalytics()
      default: return renderOverview()
    }
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{config.title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{config.subtitle} · {role}</p>
            {data && (
              <p className="mt-1 text-xs text-slate-500">
                {data.scope.scoped ? "Scoped to your assignments" : "Business-wide scope"} · {data.scope.orders} orders · updated {new Date(data.generatedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            From
            <input type="date" className={inputCls} value={draft.from ?? ""} onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined, period: undefined })} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            To
            <input type="date" className={inputCls} value={draft.to ?? ""} onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined, period: undefined })} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Period
            <select className={inputCls} value={draft.period ?? ""} onChange={(e) => setDraft({ ...draft, period: (e.target.value || undefined) as DashboardFilters["period"], from: undefined, to: undefined })}>
              <option value="">Custom</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last month</option>
              <option value="quarter">Last quarter</option>
              <option value="year">Last year</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Status
            <select className={inputCls} value={draft.status ?? ""} onChange={(e) => setDraft({ ...draft, status: e.target.value || undefined })}>
              <option value="">All statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {(role === "SUPER_ADMIN" || role === "ADMIN") && (
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              Agent
              <select className={inputCls} value={draft.agentId ?? ""} onChange={(e) => setDraft({ ...draft, agentId: e.target.value || undefined })}>
                <option value="">All agents</option>
                {agentOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <Button size="sm" onClick={applyFilters}>Apply filters</Button>
          <Button variant="ghost" size="sm" onClick={resetFilters}>Reset</Button>
        </div>

        <div role="tablist" aria-label="Dashboard sections" className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
          {config.tabs.map((id) => {
            const Icon = TAB_ICONS[id]
            return (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === id ? "bg-emerald-500/15 text-emerald-300" : "text-slate-400 hover:text-slate-100"}`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {TAB_LABELS[id]}
              </button>
            )
          })}
        </div>

        {loading && !data ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Unavailable title="Dashboard data unavailable" reason={error} />
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>Try again</Button>
          </div>
        ) : data ? (
          renderTab()
        ) : (
          <Unavailable title="No data" reason="Load the dashboard to see live values." />
        )}

        {loading && data && (
          <p className="flex items-center gap-2 text-xs text-slate-500"><RefreshCw className="h-3 w-3 animate-spin" /> Refreshing…</p>
        )}
      </div>
    </div>
  )
}
