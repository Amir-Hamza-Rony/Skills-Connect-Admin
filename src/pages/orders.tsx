import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import { OrderStatusBadge } from "@/components/status-badge"
import { createOrder, grossMargin, listClients, listOrders } from "@/lib/ops-store"
import {
  agentLabel,
  listAgents,
  listQualifications,
  listRtos,
  qualificationLabel,
  rtoLabel,
} from "@/lib/store"
import type { Agent, Client, Order, Qualification, Rto } from "@/lib/types"
import { ORDER_STATUS_GROUPS } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const aud = (n: number) => `AUD ${n.toLocaleString("en-AU")}`

/**
 * Orders queue with filters + creation. Each order keeps sales agent,
 * certificate-source agent, and issuing RTO as THREE separate fields,
 * and snapshots wholesale cost at creation (Spec §4C, §8).
 */
export function OrdersPage() {
  const { user: me } = useAuth()
  const actor = me?.id ?? "preview-user"
  const [searchParams, setSearchParams] = useSearchParams()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [quals, setQuals] = useState<Qualification[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [rtos, setRtos] = useState<Rto[]>([])

  const [fStatus, setFStatus] = useState("")
  const [fQual, setFQual] = useState("")
  const [fAgent, setFAgent] = useState("")
  const [fRto, setFRto] = useState("")

  const [creating, setCreating] = useState(searchParams.get("client") !== null)
  const [clientId, setClientId] = useState(searchParams.get("client") ?? "")
  const [qualificationId, setQualificationId] = useState("")
  const [salesAgentId, setSalesAgentId] = useState("")
  const [sourceAgentId, setSourceAgentId] = useState("")
  const [rtoId, setRtoId] = useState("")
  const [price, setPrice] = useState("")
  const [otherCost, setOtherCost] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [o, c, q, a, r] = await Promise.all([
        listOrders(),
        listClients(),
        listQualifications(),
        listAgents(),
        listRtos(),
      ])
      setOrders(o)
      setClients(c)
      setQuals(q)
      setAgents(a)
      setRtos(r)
    })()
  }, [])

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals])
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const rtoById = useMemo(() => new Map(rtos.map((r) => [r.id, r])), [rtos])

  const salesAgents = useMemo(() => agents.filter((a) => a.type === "sales_closing" && a.active), [agents])
  const sources = useMemo(() => agents.filter((a) => a.type === "certificate_source" && a.active), [agents])

  const visible = useMemo(
    () =>
      (orders ?? []).filter(
        (o) =>
          (!fStatus || o.status === fStatus) &&
          (!fQual || o.qualificationId === fQual) &&
          (!fAgent || o.salesAgentId === fAgent || o.sourceAgentId === fAgent) &&
          (!fRto || o.rtoId === fRto),
      ),
    [orders, fStatus, fQual, fAgent, fRto],
  )

  function closeCreate() {
    setCreating(false)
    setSearchParams({}, { replace: true })
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = Number(price)
    if (!clientId || !qualificationId || !salesAgentId || !sourceAgentId || !rtoId) {
      setError("Client, qualification, sales agent, source agent, and RTO are all required.")
      return
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Selling price must be a non-negative number.")
      return
    }
    setSaving(true)
    try {
      const created = await createOrder({
        clientId,
        qualificationId,
        salesAgentId,
        sourceAgentId,
        rtoId,
        sellingPrice: amount,
        otherCost: Number(otherCost) || 0,
      }, actor)
      setOrders((prev) => (prev ? [created, ...prev] : [created]))
      closeCreate()
    } finally {
      setSaving(false)
    }
  }

  if (!orders) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading orders" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Orders</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Certificate / enrolment records · {visible.length} of {orders.length} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">Preview data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            New order
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pb-4 lg:grid-cols-4">
        <select aria-label="Filter by status" value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
          <option value="">All statuses</option>
          {ORDER_STATUS_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select aria-label="Filter by qualification" value={fQual} onChange={(e) => setFQual(e.target.value)} className={inputCls}>
          <option value="">All qualifications</option>
          {quals.map((q) => (
            <option key={q.id} value={q.id}>{qualificationLabel(q)}</option>
          ))}
        </select>
        <select aria-label="Filter by agent" value={fAgent} onChange={(e) => setFAgent(e.target.value)} className={inputCls}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{agentLabel(a)}</option>
          ))}
        </select>
        <select aria-label="Filter by RTO" value={fRto} onChange={(e) => setFRto(e.target.value)} className={inputCls}>
          <option value="">All RTOs</option>
          {rtos.map((r) => (
            <option key={r.id} value={r.id}>{rtoLabel(r)}</option>
          ))}
        </select>
      </div>

      <DataTable<Order>
        rows={visible}
        emptyMessage="No orders match these filters."
        rowLabel={(o) => `${clientById.get(o.clientId)?.legalName ?? o.id} — ${qualById.get(o.qualificationId)?.code ?? ""}`}
        columns={[
          {
            key: "client",
            label: "Client",
            render: (o) => (
              <Link to={`/clients/${o.clientId}`} className="font-medium text-primary underline-offset-4 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                {clientById.get(o.clientId)?.legalName ?? o.clientId}
              </Link>
            ),
          },
          {
            key: "qual",
            label: "Qualification",
            render: (o) => (
              <Link to={`/orders/${o.id}`} className="text-primary underline-offset-4 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                {qualById.get(o.qualificationId)?.code ?? "—"}
              </Link>
            ),
          },
          {
            key: "route",
            label: "Sales / Source / RTO",
            render: (o) => (
              <span className="text-xs text-muted-foreground">
                {agentById.get(o.salesAgentId)?.name ?? "—"}
                {" / "}
                {agentById.get(o.sourceAgentId)?.name ?? "—"}
                {" / "}
                {rtoById.get(o.rtoId)?.tradingName ?? "—"}
              </span>
            ),
          },
          {
            key: "money",
            label: "Price / Margin",
            render: (o) => (
              <span className="tabular-nums">{aud(o.sellingPrice)} <span className="text-muted-foreground">/ {aud(grossMargin(o))}</span></span>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (o) => <OrderStatusBadge status={o.status} />,
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={closeCreate}
        title="New certificate order"
        description="Wholesale cost snapshots from the active pricing route at creation."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="o-client" className="text-sm font-medium">Client</label>
              <select id="o-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls}>
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.legalName}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="o-qual" className="text-sm font-medium">Qualification</label>
              <select id="o-qual" value={qualificationId} onChange={(e) => setQualificationId(e.target.value)} className={inputCls}>
                <option value="">Select qualification…</option>
                {quals.map((q) => (
                  <option key={q.id} value={q.id}>{qualificationLabel(q)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="o-sales" className="text-sm font-medium">Sales agent</label>
              <select id="o-sales" value={salesAgentId} onChange={(e) => setSalesAgentId(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {salesAgents.map((a) => (
                  <option key={a.id} value={a.id}>{agentLabel(a)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="o-src" className="text-sm font-medium">Source agent</label>
              <select id="o-src" value={sourceAgentId} onChange={(e) => setSourceAgentId(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {sources.map((a) => (
                  <option key={a.id} value={a.id}>{agentLabel(a)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="o-rto" className="text-sm font-medium">Issuing RTO</label>
              <select id="o-rto" value={rtoId} onChange={(e) => setRtoId(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {rtos.map((r) => (
                  <option key={r.id} value={r.id}>{rtoLabel(r)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="o-price" className="text-sm font-medium">Selling price (AUD)</label>
              <input id="o-price" type="number" min="0" step="1" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="2500" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="o-other" className="text-sm font-medium">Other cost (AUD)</label>
              <input id="o-other" type="number" min="0" step="1" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} placeholder="0" className={inputCls} />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeCreate}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create order"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
