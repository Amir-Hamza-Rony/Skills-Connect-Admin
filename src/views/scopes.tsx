"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createScope,
  deleteScope,
  listScopes,
  updateScope,
} from "@/lib/store"
import type { DeliveryMode, RtoQualificationScope } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const DELIVERY_MODES: DeliveryMode[] = ["RPL", "ONLINE", "CLASSROOM"]

export function ScopesPage() {
  const [rows, setRows] = useState<RtoQualificationScope[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<RtoQualificationScope | null>(null)
  const [search, setSearch] = useState("")
  const [modeFilter, setModeFilter] = useState<DeliveryMode | "">("")
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "">("")

  const [qualId, setQualId] = useState("")
  const [partnerId, setPartnerId] = useState("")
  const [rtoId, setRtoId] = useState("")
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("RPL")
  const [trueRtoCost, setTrueRtoCost] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listScopes()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((s) => {
      if (search && !s.qualificationId.toLowerCase().includes(search.toLowerCase())) return false
      if (modeFilter && s.deliveryMode !== modeFilter) return false
      if (statusFilter && s.status !== statusFilter) return false
      return true
    })
  }, [rows, search, modeFilter, statusFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!qualId.trim() || !rtoId.trim() || !trueRtoCost.trim()) {
      setError("Qualification ID, RTO ID, and True RTO cost are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createScope({
        qualificationId: qualId.trim(),
        intermediaryPartnerId: partnerId.trim() || null,
        issuingRtoId: rtoId.trim(),
        deliveryMode,
        trueRtoCost: Number(trueRtoCost),
        currency: "AUD",
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || null,
        status: "active",
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setQualId("")
      setPartnerId("")
      setRtoId("")
      setDeliveryMode("RPL")
      setTrueRtoCost("")
      setEffectiveFrom("")
      setEffectiveTo("")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create scope.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, s: RtoQualificationScope) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const updated = await updateScope(s.id, {
        intermediaryPartnerId: partnerId.trim() || null,
        issuingRtoId: rtoId.trim() || s.issuingRtoId,
        deliveryMode,
        trueRtoCost: Number(trueRtoCost),
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || null,
        status: statusFilter || s.status,
      })
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update scope.")
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this scope?")) return
    setSaving(true)
    try {
      await deleteScope(id)
      setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev))
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete scope.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading scopes" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Qualification Scopes
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Composite-key pricing: qualification + partner + RTO + delivery mode → True RTO Cost
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Phase 4</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add scope
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search qualification…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value as DeliveryMode | "")}
          className={inputCls}
        >
          <option value="">All delivery modes</option>
          {DELIVERY_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "active" | "inactive" | "")}
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable<RtoQualificationScope>
        rows={visible}
        emptyMessage="No scopes match the current filters."
        columns={[
          {
            key: "qualificationId",
            label: "Qualification",
            render: (s) => <span className="font-medium">{s.qualificationId}</span>,
          },
          {
            key: "partnerId",
            label: "Partner",
            render: (s) => (
              <span className="text-muted-foreground">
                {s.intermediaryPartnerId || "—"}
              </span>
            ),
          },
          {
            key: "rtoId",
            label: "Issuing RTO",
            render: (s) => <span className="font-medium">{s.issuingRtoId}</span>,
          },
          {
            key: "deliveryMode",
            label: "Delivery Mode",
            render: (s) => (
              <Badge variant="secondary">{s.deliveryMode}</Badge>
            ),
          },
          {
            key: "trueRtoCost",
            label: "True RTO Cost",
            render: (s) => `AUD ${s.trueRtoCost.toLocaleString()}`,
          },
          {
            key: "status",
            label: "Status",
            render: (s) => (
              <Badge variant={s.status === "active" ? "success" : "secondary"}>
                {s.status}
              </Badge>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (s) => (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQualId(s.qualificationId)
                    setPartnerId(s.intermediaryPartnerId ?? "")
                    setRtoId(s.issuingRtoId)
                    setDeliveryMode(s.deliveryMode)
                    setTrueRtoCost(String(s.trueRtoCost))
                    setEffectiveFrom(s.effectiveFrom ?? "")
                    setEffectiveTo(s.effectiveTo ?? "")
                    setStatusFilter(s.status)
                    setEditing(s)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onDelete(s.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add qualification scope"
        description="Set the True RTO Base Cost for a qualification→RTO→partner→delivery-mode combination."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="scope-qual">Qualification ID</Label>
              <Input
                id="scope-qual"
                value={qualId}
                onChange={(e) => setQualId(e.target.value)}
                placeholder="e.g. 64f…"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scope-partner">Intermediary Partner ID</Label>
              <Input
                id="scope-partner"
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                placeholder="optional partner id"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="scope-rto">Issuing RTO ID</Label>
              <Input
                id="scope-rto"
                value={rtoId}
                onChange={(e) => setRtoId(e.target.value)}
                placeholder="e.g. 64f…"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scope-mode">Delivery Mode</Label>
              <select
                id="scope-mode"
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}
                className={inputCls}
              >
                {DELIVERY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="scope-cost">True RTO Cost (AUD)</Label>
              <Input
                id="scope-cost"
                type="number"
                value={trueRtoCost}
                onChange={(e) => setTrueRtoCost(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scope-from">Effective From</Label>
              <Input
                id="scope-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scope-to">Effective To (optional)</Label>
            <Input
              id="scope-to"
              type="date"
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
              className={inputCls}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add scope"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit qualification scope"
        description={editing ? `Qualification: ${editing.qualificationId}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="eq-qual">Qualification ID</Label>
              <Input
                id="eq-qual"
                value={qualId}
                onChange={(e) => setQualId(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eq-partner">Intermediary Partner ID</Label>
              <Input
                id="eq-partner"
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="eq-rto">Issuing RTO ID</Label>
              <Input
                id="eq-rto"
                value={rtoId}
                onChange={(e) => setRtoId(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eq-mode">Delivery Mode</Label>
              <select
                id="eq-mode"
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}
                className={inputCls}
              >
                {DELIVERY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="eq-cost">True RTO Cost (AUD)</Label>
              <Input
                id="eq-cost"
                type="number"
                value={trueRtoCost}
                onChange={(e) => setTrueRtoCost(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eq-from">Effective From</Label>
              <Input
                id="eq-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-to">Effective To (optional)</Label>
            <Input
              id="eq-to"
              type="date"
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-status">Status</Label>
            <select
              id="eq-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "active" | "inactive" | "")}
              className={inputCls}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save scope"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
