import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  agentLabel,
  createRoute,
  expireRoute,
  listAgents,
  listQualifications,
  listRoutes,
  listRtos,
  qualificationLabel,
  rtoLabel,
} from "@/lib/store"
import type { Agent, Qualification, Rto, SupplierRoute } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const aud = (n: number) =>
  `AUD ${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`

/**
 * Supplier pricing matrix: qualification → certificate-source agent →
 * issuing RTO → wholesale cost. History is immutable — expiring a route
 * preserves it; old orders keep their snapshots (Spec §4G).
 */
export function PricingPage() {
  const [routes, setRoutes] = useState<SupplierRoute[] | null>(null)
  const [quals, setQuals] = useState<Qualification[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [rtos, setRtos] = useState<Rto[]>([])
  const [creating, setCreating] = useState(false)
  const [qualificationId, setQualificationId] = useState("")
  const [sourceAgentId, setSourceAgentId] = useState("")
  const [rtoId, setRtoId] = useState("")
  const [cost, setCost] = useState("")
  const [from, setFrom] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expiring, setExpiring] = useState<SupplierRoute | null>(null)

  useEffect(() => {
    void (async () => {
      const [r, q, a, t] = await Promise.all([
        listRoutes(),
        listQualifications(),
        listAgents(),
        listRtos(),
      ])
      setRoutes(r)
      setQuals(q)
      setAgents(a)
      setRtos(t)
    })()
  }, [])

  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals])
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const rtoById = useMemo(() => new Map(rtos.map((r) => [r.id, r])), [rtos])
  const sources = useMemo(
    () => agents.filter((a) => a.type === "certificate_source" && a.active),
    [agents],
  )

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = Number(cost)
    if (!qualificationId || !sourceAgentId || !rtoId || !from) {
      setError("Qualification, source agent, RTO, and effective date are required.")
      return
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Wholesale cost must be a non-negative number.")
      return
    }
    setSaving(true)
    try {
      const created = await createRoute({
        qualificationId,
        sourceAgentId,
        rtoId,
        wholesaleCost: amount,
        currency: "AUD",
        effectiveFrom: from,
        effectiveTo: null,
        status: "active",
      })
      setRoutes((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setCost("")
      setFrom("")
    } finally {
      setSaving(false)
    }
  }

  async function onExpire() {
    if (!expiring) return
    const updated = await expireRoute(expiring.id)
    setRoutes((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
    setExpiring(null)
  }

  if (!routes) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading pricing" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Supplier Pricing
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Wholesale cost per qualification → source → RTO · {routes.length} routes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">Preview data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add route
          </Button>
        </div>
      </div>

      <DataTable<SupplierRoute>
        rows={routes}
        emptyMessage="No supplier routes yet — add the first one."
        rowLabel={(r) =>
          `${qualById.get(r.qualificationId)?.code ?? "?"} / ${agentById.get(r.sourceAgentId)?.name ?? "?"} / ${rtoById.get(r.rtoId)?.tradingName ?? "?"}`
        }
        columns={[
          {
            key: "qualification",
            label: "Qualification",
            render: (r) => qualById.get(r.qualificationId)?.code ?? "—",
          },
          {
            key: "source",
            label: "Source agent",
            render: (r) => agentById.get(r.sourceAgentId)?.name ?? "—",
          },
          {
            key: "rto",
            label: "Issuing RTO",
            render: (r) => rtoById.get(r.rtoId)?.tradingName ?? "—",
          },
          {
            key: "cost",
            label: "Wholesale",
            render: (r) => <span className="font-medium tabular-nums">{aud(r.wholesaleCost)}</span>,
          },
          {
            key: "effective",
            label: "Effective",
            render: (r) => (
              <span className="tabular-nums">
                {r.effectiveFrom} → {r.effectiveTo ?? "present"}
              </span>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (r) =>
              r.status === "active" ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="outline">Expired</Badge>
              ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (r) =>
              r.status === "active" ? (
                <Button size="sm" variant="outline" onClick={() => setExpiring(r)}>
                  Expire
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Kept for history</span>
              ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add supplier route"
        description="New wholesale price applies to new orders only — history is never rewritten."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="sr-qual" className="text-sm font-medium">Qualification</label>
            <select id="sr-qual" value={qualificationId} onChange={(e) => setQualificationId(e.target.value)} className={inputCls}>
              <option value="">Select qualification…</option>
              {quals.map((q) => (
                <option key={q.id} value={q.id}>{qualificationLabel(q)}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="sr-src" className="text-sm font-medium">Source agent</label>
              <select id="sr-src" value={sourceAgentId} onChange={(e) => setSourceAgentId(e.target.value)} className={inputCls}>
                <option value="">Select source…</option>
                {sources.map((a) => (
                  <option key={a.id} value={a.id}>{agentLabel(a)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sr-rto" className="text-sm font-medium">Issuing RTO</label>
              <select id="sr-rto" value={rtoId} onChange={(e) => setRtoId(e.target.value)} className={inputCls}>
                <option value="">Select RTO…</option>
                {rtos.map((r) => (
                  <option key={r.id} value={r.id}>{rtoLabel(r)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="sr-cost" className="text-sm font-medium">Wholesale cost (AUD)</label>
              <input id="sr-cost" type="number" min="0" step="1" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="700" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sr-from" className="text-sm font-medium">Effective from</label>
              <input id="sr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add route"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={expiring !== null}
        onClose={() => setExpiring(null)}
        title="Expire this route?"
        description="The route stays in history with an end date — it is never deleted."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setExpiring(null)}>
            Keep active
          </Button>
          <Button variant="destructive" onClick={onExpire}>
            Expire route
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
