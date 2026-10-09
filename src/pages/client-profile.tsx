import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CertificateBadge,
  DocumentStatusBadge,
  EvidenceBadge,
  OrderStatusBadge,
  RtoSubmissionBadge,
} from "@/components/status-badge"
import { useAuth } from "@/lib/auth"
import { hasPermission } from "@/lib/permissions"
import { getClient, grossMargin, listDocuments, listOrders } from "@/lib/ops-store"
import {
  listAgents,
  listQualifications,
  listRtos,
  listUsers,
  qualificationLabel,
} from "@/lib/store"
import type {
  Agent,
  Client,
  Order,
  OrderDocument,
  Qualification,
  Rto,
  User,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const aud = (n: number) => `AUD ${n.toLocaleString("en-AU")}`

const TABS = [
  "Orders",
  "Documents",
  "Payments",
  "Invoices",
  "Timeline",
  "Notes",
  "Audit",
] as const
type Tab = (typeof TABS)[number]

/**
 * Client profile workspace (Spec §19): header + financial strip + tabs.
 * Payments/Invoices wire to real data on Day 4 — shown honestly as pending.
 */
export function ClientProfilePage() {
  const { id } = useParams()
  const { permissions } = useAuth()
  const [client, setClient] = useState<Client | null | undefined>(undefined)
  const [orders, setOrders] = useState<Order[]>([])
  const [docs, setDocs] = useState<OrderDocument[]>([])
  const [quals, setQuals] = useState<Qualification[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [rtos, setRtos] = useState<Rto[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [tab, setTab] = useState<Tab>("Orders")

  useEffect(() => {
    void (async () => {
      if (!id) return
      const [c, o, q, a, r, u] = await Promise.all([
        getClient(id),
        listOrders(id),
        listQualifications(),
        listAgents(),
        listRtos(),
        listUsers(),
      ])
      setClient(c ?? null)
      setOrders(o)
      setQuals(q)
      setAgents(a)
      setRtos(r)
      setUsers(u)
      const allDocs = (
        await Promise.all(o.map((ord) => listDocuments(ord.id)))
      ).flat()
      setDocs(allDocs)
    })()
  }, [id])

  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals])
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const rtoById = useMemo(() => new Map(rtos.map((r) => [r.id, r])), [rtos])
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  const quoted = useMemo(() => orders.reduce((s, o) => s + o.sellingPrice, 0), [orders])
  const margin = useMemo(() => orders.reduce((s, o) => s + grossMargin(o), 0), [orders])
  const timeline = useMemo(
    () =>
      orders
        .flatMap((o) => o.history.map((h) => ({ ...h, orderId: o.id })))
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    [orders],
  )

  if (client === undefined) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-24 w-full" aria-label="Loading client" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (client === null) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <p className="font-medium">Client not found.</p>
        <Link to="/clients" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to clients
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link to="/clients" className="underline-offset-4 hover:underline">Clients</Link>
            {" / "}{client.id}
          </p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
            {client.legalName}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {client.preferredName} · {client.phone} · {client.email}
          </p>
        </div>
        <Badge variant={client.status === "Active" ? "success" : "warning"}>
          {client.status}
        </Badge>
      </div>

      {/* Financial strip */}
      <div className="grid grid-cols-2 gap-3 pt-4 lg:grid-cols-4">
        {[
          { label: "Orders value", value: aud(quoted) },
          { label: "Est. margin", value: aud(margin) },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
          </div>
        ))}
        {["Paid", "Outstanding"].map((k) => (
          <div key={k} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-1 text-sm text-muted-foreground">Connects Day 4</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Client sections" className="flex gap-1 overflow-x-auto border-b pt-4">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {tab === "Orders" && (
          <div className="space-y-2.5">
            <div className="flex justify-end">
              <Link to={`/orders?client=${client.id}`} className={buttonVariants({ size: "sm" })}>
                New order
              </Link>
            </div>
            {orders.length === 0 && (
              <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
                No orders yet — create the first qualification order.
              </p>
            )}
            {orders.map((o) => (
              <Link
                key={o.id}
                to={`/orders/${o.id}`}
                className="block rounded-xl border bg-card p-4 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {qualById.get(o.qualificationId)
                      ? qualificationLabel(qualById.get(o.qualificationId)!)
                      : o.qualificationId}
                  </p>
                  <OrderStatusBadge status={o.status} />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  <EvidenceBadge status={o.evidenceStatus} />
                  <RtoSubmissionBadge status={o.rtoSubmissionStatus} />
                  <CertificateBadge status={o.certificateStatus} />
                </div>
                <p className="pt-2 text-sm text-muted-foreground">
                  Sales: {agentById.get(o.salesAgentId)?.name ?? "—"}
                  {" · "}Source: {agentById.get(o.sourceAgentId)?.name ?? "—"}
                  {" · "}RTO: {rtoById.get(o.rtoId)?.tradingName ?? "—"}
                  {" · "}{aud(o.sellingPrice)}
                </p>
              </Link>
            ))}
          </div>
        )}

        {tab === "Documents" && (
          <div className="space-y-2">
            {docs.length === 0 && (
              <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
                No documents yet.
              </p>
            )}
            {docs.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3.5">
                <div>
                  <p className="text-sm font-medium">{d.type} <span className="text-muted-foreground">· v{d.version}</span></p>
                  <p className="text-xs text-muted-foreground">
                    Order {d.orderId}
                    {d.rejectionReason ? ` · ${d.rejectionReason}` : ""}
                  </p>
                </div>
                <DocumentStatusBadge status={d.status} />
              </div>
            ))}
          </div>
        )}

        {(tab === "Payments" || tab === "Invoices") && (
          <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            {tab} connect on Day 4 with invoices, plans, and allocations.
          </p>
        )}

        {tab === "Timeline" && (
          <ol className="space-y-0">
            {timeline.map((h, i) => (
              <li key={i} className="flex gap-3 border-l-2 border-primary/30 pb-4 pl-4 last:pb-0">
                <div className="-ml-[21px] mt-1 size-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <div className="text-sm">
                  <p>
                    <span className="font-medium">{h.field}</span>: {h.before} →{" "}
                    <span className="font-medium">{h.after}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Order {h.orderId} · {userById.get(h.actorId)?.name ?? h.actorId} ·{" "}
                    {new Date(h.timestamp).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
            {timeline.length === 0 && (
              <p className="text-sm text-muted-foreground">No history yet.</p>
            )}
          </ol>
        )}

        {tab === "Notes" && (
          <div className="rounded-xl border bg-card p-4 text-sm">
            <p>{client.notes || "No notes recorded."}</p>
            <p className="pt-2 text-xs text-muted-foreground">
              Address: {client.address || "—"} · Communication log connects with messaging later.
            </p>
          </div>
        )}

        {tab === "Audit" && (
          <div>
            {!hasPermission(permissions, "audit.view") ? (
              <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
                Restricted — your role cannot view the audit trail.
              </p>
            ) : (
              <ol className="space-y-0">
                {timeline.map((h, i) => (
                  <li key={i} className="border-b py-2 text-sm last:border-b-0">
                    <code className="text-xs">{h.timestamp}</code> · {h.actorId} ·{" "}
                    {h.field}: {h.before} → {h.after} <span className="text-muted-foreground">(order {h.orderId})</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
