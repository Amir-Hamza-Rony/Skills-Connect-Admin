import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CertificateBadge,
  EvidenceBadge,
  OrderStatusBadge,
  RtoSubmissionBadge,
} from "@/components/status-badge"
import { useAuth } from "@/lib/auth"
import {
  getClient,
  getOrder,
  grossMargin,
  listDocuments,
  listTasks,
  transitionOrder,
  updateOrderDimensions,
} from "@/lib/ops-store"
import { listInvoices, listPayments } from "@/lib/fin-store"
import {
  listAgents,
  listQualifications,
  listRtos,
  listUsers,
  qualificationLabel,
} from "@/lib/store"
import {
  ORDER_STATUS_GROUPS,
  type Agent,
  type Client,
  type EvidenceStatus,
  type Invoice,
  type Order,
  type OrderDocument,
  type OrderStatus,
  type Payment,
  type Qualification,
  type Rto,
  type RtoSubmissionStatus,
  type User,
  type WorkflowTask,
} from "@/lib/types"

const aud = (n: number) => `AUD ${n.toLocaleString("en-AU")}`

const EVIDENCE_OPTS: EvidenceStatus[] = ["Not Started", "In Progress", "Complete", "Additional Evidence Required"]
const RTO_OPTS: RtoSubmissionStatus[] = ["Not Ready", "Ready", "Submitted", "Acknowledged", "Under Assessment", "Additional Evidence Required", "Issued"]

const inputCls =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Order detail: three separate agent/RTO fields, price snapshots, margin,
 * grouped status transitions, evidence/RTO dimensions, tasks, timeline.
 */
export function OrderDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const [order, setOrder] = useState<Order | null | undefined>(undefined)
  const [client, setClient] = useState<Client | null>(null)
  const [quals, setQuals] = useState<Qualification[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [rtos, setRtos] = useState<Rto[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [docs, setDocs] = useState<OrderDocument[]>([])
  const [tasks, setTasks] = useState<WorkflowTask[]>([])
  const [orderInvoices, setOrderInvoices] = useState<Invoice[]>([])
  const [orderPayments, setOrderPayments] = useState<Payment[]>([])
  const [nextStatus, setNextStatus] = useState<OrderStatus | "">("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      if (!id) return
      const o = await getOrder(id)
      setOrder(o ?? null)
      if (!o) return
      const [c, q, a, r, u, d, t, inv, pay] = await Promise.all([
        getClient(o.clientId),
        listQualifications(),
        listAgents(),
        listRtos(),
        listUsers(),
        listDocuments(o.id),
        listTasks(o.id),
        listInvoices(o.id),
        listPayments(o.id),
      ])
      setClient(c ?? null)
      setQuals(q)
      setAgents(a)
      setRtos(r)
      setUsers(u)
      setDocs(d)
      setTasks(t)
      setOrderInvoices(inv)
      setOrderPayments(pay.filter((p) => p.status !== "Void" && p.status !== "Refunded"))
    })()
  }, [id])

  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals])
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const rtoById = useMemo(() => new Map(rtos.map((r) => [r.id, r])), [rtos])
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  if (order === undefined) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-24 w-full" aria-label="Loading order" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (order === null) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <p className="font-medium">Order not found.</p>
        <Link to="/orders" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to orders
        </Link>
      </div>
    )
  }

  async function applyTransition() {
    if (!nextStatus || !id) return
    setBusy(true)
    try {
      setOrder(await transitionOrder(id, nextStatus, user?.id ?? "preview-user"))
      setNextStatus("")
    } finally {
      setBusy(false)
    }
  }

  async function applyDimension(
    patch:
      | { evidenceStatus: EvidenceStatus }
      | { rtoSubmissionStatus: RtoSubmissionStatus },
  ) {
    if (!id) return
    setBusy(true)
    try {
      setOrder(await updateOrderDimensions(id, patch, user?.id ?? "preview-user"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link to="/orders" className="underline-offset-4 hover:underline">Orders</Link>
            {" / "}{order.id}
            {" · Client: "}
            <Link to={`/clients/${order.clientId}`} className="text-primary underline-offset-4 hover:underline">
              {client?.legalName ?? order.clientId}
            </Link>
          </p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
            {qualById.get(order.qualificationId)
              ? qualificationLabel(qualById.get(order.qualificationId)!)
              : order.qualificationId}
          </h1>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Three separate relationships */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Sales / Closing Agent", value: agentById.get(order.salesAgentId)?.name },
          { label: "Certificate Source Agent", value: agentById.get(order.sourceAgentId)?.name },
          { label: "Issuing RTO / College", value: rtoById.get(order.rtoId)?.tradingName },
        ].map((f) => (
          <div key={f.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{f.label}</p>
            <p className="mt-1 text-sm font-medium">
              {f.value ?? "—"}
              {f.label.startsWith("Issuing") && rtoById.get(order.rtoId) ? ` (${rtoById.get(order.rtoId)!.rtoCode})` : ""}
            </p>
          </div>
        ))}
      </div>

      {/* Commercials */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Selling price", value: aud(order.sellingPrice) },
          { label: "Supplier cost (snapshot)", value: aud(order.supplierCostSnapshot) },
          { label: "Other cost", value: aud(order.otherCost) },
          { label: "Est. margin", value: aud(grossMargin(order)) },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Snapshots are frozen at order creation — later pricing-matrix edits never rewrite them.
      </p>

      {/* Invoices & payments */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <h2 className="text-sm font-semibold">
            Invoices & payments (
            {orderInvoices.filter((i) => i.status !== "Void").reduce((s, i) => s + i.total, 0) > 0
              ? aud(orderInvoices.filter((i) => i.status !== "Void").reduce((s, i) => s + i.total, 0))
              : "none invoiced"}
            {" · "}
            paid {aud(orderPayments.reduce((s, p) => s + p.allocatedAmount, 0))})
          </h2>
          <Link to="/finance" className="text-xs text-primary underline-offset-4 hover:underline">
            Open Finance →
          </Link>
        </div>
        {orderInvoices.length === 0 && orderPayments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing invoiced or paid yet — create the invoice in Finance.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            {orderInvoices.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
                <span className="font-medium tabular-nums">{i.invoiceNumber} · {aud(i.total)}</span>
                <Badge variant={i.status === "Paid" ? "success" : i.status === "Void" ? "outline" : "info"}>{i.status}</Badge>
              </div>
            ))}
            {orderPayments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
                <span className="tabular-nums">{aud(p.amount)} · {p.method} · {p.date}</span>
                <Badge variant="secondary">{p.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workflow controls */}
      <div className="rounded-xl border bg-card p-4">
        <h2 className="pb-3 text-sm font-semibold">Workflow</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="od-status" className="text-xs font-medium text-muted-foreground">Order status</label>
            <div className="flex gap-2">
              <select id="od-status" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as OrderStatus | "")} className={`${inputCls} flex-1`} disabled={busy}>
                <option value="">Change to…</option>
                {ORDER_STATUS_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.statuses.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <Button size="sm" onClick={applyTransition} disabled={!nextStatus || busy}>
                Apply
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="od-ev" className="text-xs font-medium text-muted-foreground">Evidence</label>
            <select id="od-ev" value={order.evidenceStatus} onChange={(e) => void applyDimension({ evidenceStatus: e.target.value as EvidenceStatus })} className={`${inputCls} w-full`} disabled={busy}>
              {EVIDENCE_OPTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div><EvidenceBadge status={order.evidenceStatus} /></div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="od-rto" className="text-xs font-medium text-muted-foreground">RTO submission</label>
            <select id="od-rto" value={order.rtoSubmissionStatus} onChange={(e) => void applyDimension({ rtoSubmissionStatus: e.target.value as RtoSubmissionStatus })} className={`${inputCls} w-full`} disabled={busy}>
              {RTO_OPTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="flex gap-1.5">
              <RtoSubmissionBadge status={order.rtoSubmissionStatus} />
              <CertificateBadge status={order.certificateStatus} />
            </div>
          </div>
        </div>
      </div>

      {/* Tasks + timeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <h2 className="pb-3 text-sm font-semibold">Tasks ({tasks.length})</h2>
          <div className="space-y-2">
            {tasks.length === 0 && (
              <p className="text-sm text-muted-foreground">No tasks for this order.</p>
            )}
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
                <div>
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.stage}{t.dueDate ? ` · due ${t.dueDate}` : ""}</p>
                </div>
                <Badge variant={t.status === "Done" ? "success" : t.status === "Blocked" ? "destructive" : "secondary"}>
                  {t.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <h2 className="pb-3 text-sm font-semibold">
            Status history ({order.history.length})
          </h2>
          <ol>
            {[...order.history].reverse().map((h, i) => (
              <li key={i} className="flex gap-3 border-l-2 border-primary/30 pb-3 pl-4 text-sm last:pb-0">
                <div className="-ml-[21px] mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <div>
                  <p><span className="font-medium">{h.field}</span>: {h.before} → <span className="font-medium">{h.after}</span></p>
                  <p className="text-xs text-muted-foreground">
                    {userById.get(h.actorId)?.name ?? h.actorId} · {new Date(h.timestamp).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {docs.length} document{docs.length === 1 ? "" : "s"} on checklist —{" "}
        <Link to="/documents" className="text-primary underline-offset-4 hover:underline">
          open Documents workspace
        </Link>
        .
      </p>
    </div>
  )
}
