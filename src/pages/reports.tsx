import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { financeSummary, listInvoices } from "@/lib/fin-store"
import { grossMargin, listClients, listOrders } from "@/lib/ops-store"
import { listAgents, listQualifications } from "@/lib/store"
import type { Agent, Client, Invoice, Order, Qualification } from "@/lib/types"

const aud = (n: number) => `AUD ${n.toLocaleString("en-AU")}`

interface ReportData {
  orders: Order[]
  clients: Client[]
  quals: Qualification[]
  agents: Agent[]
  invoices: Invoice[]
}

/** Day-4 operational reports (Spec §4K): revenue, ageing, margin, funnel. */
export function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [paid, setPaid] = useState(0)

  useEffect(() => {
    void (async () => {
      const [orders, clients, quals, agents, invoices, summary] = await Promise.all([
        listOrders(),
        listClients(),
        listQualifications(),
        listAgents(),
        listInvoices(),
        financeSummary(),
      ])
      setData({ orders, clients, quals, agents, invoices })
      setPaid(summary.paid)
    })()
  }, [])

  const qualById = useMemo(
    () => new Map((data?.quals ?? []).map((q) => [q.id, q])),
    [data],
  )
  const agentById = useMemo(
    () => new Map((data?.agents ?? []).map((a) => [a.id, a])),
    [data],
  )

  const byQualification = useMemo(() => {
    const m = new Map<string, { revenue: number; margin: number; count: number }>()
    for (const o of data?.orders ?? []) {
      const key = qualById.get(o.qualificationId)?.code ?? o.qualificationId
      const cur = m.get(key) ?? { revenue: 0, margin: 0, count: 0 }
      cur.revenue += o.sellingPrice
      cur.margin += grossMargin(o)
      cur.count += 1
      m.set(key, cur)
    }
    return [...m.entries()]
  }, [data, qualById])

  const bySalesAgent = useMemo(() => {
    const m = new Map<string, { orders: number; revenue: number }>()
    for (const o of data?.orders ?? []) {
      const key = agentById.get(o.salesAgentId)?.name ?? o.salesAgentId
      const cur = m.get(key) ?? { orders: 0, revenue: 0 }
      cur.orders += 1
      cur.revenue += o.sellingPrice
      m.set(key, cur)
    }
    return [...m.entries()]
  }, [data, agentById])

  const byStage = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of data?.orders ?? []) m.set(o.status, (m.get(o.status) ?? 0) + 1)
    return [...m.entries()]
  }, [data])

  if (!data) {
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
            Revenue, collections, margin, pipeline · {data.orders.length} orders
          </p>
        </div>
        <Badge variant="info">Preview data</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Revenue by qualification">
          <Rows
            rows={byQualification.map(([k, v]) => ({
              label: k,
              detail: `${v.count} order${v.count === 1 ? "" : "s"}`,
              value: `${aud(v.revenue)} · margin ${aud(v.margin)}`,
            }))}
          />
        </ReportCard>
        <ReportCard title="Agent performance (sales)">
          <Rows
            rows={bySalesAgent.map(([k, v]) => ({
              label: k,
              detail: `${v.orders} order${v.orders === 1 ? "" : "s"}`,
              value: aud(v.revenue),
            }))}
          />
        </ReportCard>
        <ReportCard title="Orders by workflow stage">
          <Rows rows={byStage.map(([k, v]) => ({ label: k, detail: "", value: String(v) }))} />
        </ReportCard>
        <ReportCard title="Collections">
          <Rows
            rows={[
              { label: "Invoiced", detail: "", value: aud(data.invoices.filter((i) => i.status !== "Void").reduce((s, i) => s + i.total, 0)) },
              { label: "Collected", detail: "", value: aud(paid) },
              {
                label: "Overdue invoices",
                detail: "",
                value: String(data.invoices.filter((i) => i.status === "Overdue").length),
              },
            ]}
          />
        </ReportCard>
      </div>
      <p className="text-xs text-muted-foreground">
        {data.clients.length} clients in scope. Full ageing, RTO turnaround, and
        exportable reports arrive with the backend + migration.
      </p>
    </div>
  )
}

function ReportCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="pb-3 text-sm font-semibold">{title}</h2>
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
            {r.detail && <span className="block text-xs text-muted-foreground">{r.detail}</span>}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{r.value}</span>
        </li>
      ))}
    </ul>
  )
}
