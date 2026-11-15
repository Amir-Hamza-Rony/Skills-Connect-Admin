"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createMapping,
  deleteMapping,
  listMappings,
  listQualifications,
  listRtos,
  qualificationLabel,
  rtoLabel,
  updateMapping,
  type MappingItem,
} from "@/lib/store"
import type { Qualification, Rto } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<string, "success" | "outline"> = {
  active: "success",
  inactive: "outline",
}

export function QualificationRtoMappingsPage() {
  const [rows, setRows] = useState<MappingItem[] | null>(null)
  const [quals, setQuals] = useState<Qualification[]>([])
  const [rtos, setRtos] = useState<Rto[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<MappingItem | null>(null)
  const [search, setSearch] = useState("")
  const [qualFilter, setQualFilter] = useState("")
  const [rtoFilter, setRtoFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "">("")
  const [qualificationId, setQualificationId] = useState("")
  const [rtoId, setRtoId] = useState("")
  const [mStatus, setMStatus] = useState<"active" | "inactive">("active")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals])
  const rtoById = useMemo(() => new Map(rtos.map((r) => [r.id, r])), [rtos])

  useEffect(() => {
    void (async () => {
      const [m, q, r] = await Promise.all([listMappings(), listQualifications(), listRtos()])
      setRows(m)
      setQuals(q)
      setRtos(r)
    })()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((m) => {
      const q = qualById.get(m.qualificationId)
      const r = rtoById.get(m.rtoId)
      const label = `${(q?.code ?? "")} ${(q?.title ?? "")} ${(r?.tradingName ?? "")} ${(r?.rtoCode ?? "")}`.toLowerCase()
      if (search && !label.includes(search.toLowerCase())) return false
      if (qualFilter && m.qualificationId !== qualFilter) return false
      if (rtoFilter && m.rtoId !== rtoFilter) return false
      if (statusFilter && m.status !== statusFilter) return false
      return true
    })
  }, [rows, search, qualFilter, rtoFilter, statusFilter, qualById, rtoById])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!qualificationId || !rtoId) {
      setError("Qualification and RTO are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createMapping({
        qualificationId,
        rtoId,
        status: mStatus,
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || undefined,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setQualificationId("")
      setRtoId("")
      setMStatus("active")
      setEffectiveFrom("")
      setEffectiveTo("")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create mapping. It may already exist.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, m: MappingItem) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const updated = await updateMapping(m.id, {
        status: mStatus,
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || undefined,
      })
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update mapping.")
    } finally {
      setSaving(false)
    }
  }

  async function removeMapping(m: MappingItem) {
    if (!window.confirm(`Remove mapping between ${qualById.get(m.qualificationId)?.code ?? "qualification"} and ${rtoById.get(m.rtoId)?.tradingName ?? "RTO"}?`)) return
    setError(null)
    setSaving(true)
    try {
      await deleteMapping(m.id)
      setRows((prev) => prev?.filter((r) => r.id !== m.id) ?? null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to remove mapping.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading mappings" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Qualification ↔ RTO Mappings
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Which qualifications each RTO can deliver · {visible.length} mappings
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add mapping
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search qualification or RTO…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={qualFilter}
          onChange={(e) => setQualFilter(e.target.value)}
          className={inputCls}
        >
          <option value="">All qualifications</option>
          {quals.map((q) => (
            <option key={q.id} value={q.id}>
              {qualificationLabel(q)}
            </option>
          ))}
        </select>
        <select
          value={rtoFilter}
          onChange={(e) => setRtoFilter(e.target.value)}
          className={inputCls}
        >
          <option value="">All RTOs</option>
          {rtos.map((r) => (
            <option key={r.id} value={r.id}>
              {rtoLabel(r)}
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

      <DataTable<MappingItem>
        rows={visible}
        emptyMessage="No mappings match the current filters."
        rowLabel={(m) => `${qualById.get(m.qualificationId)?.code ?? "?"} ↔ ${rtoById.get(m.rtoId)?.tradingName ?? "?"}`}
        columns={[
          {
            key: "qualification",
            label: "Qualification",
            render: (m) => qualificationLabel(qualById.get(m.qualificationId) ?? ({} as Qualification)),
          },
          {
            key: "rto",
            label: "RTO",
            render: (m) => rtoLabel(rtoById.get(m.rtoId) ?? ({} as Rto)),
          },
          {
            key: "status",
            label: "Status",
            render: (m) => (
              <Badge variant={STATUS_VARIANT[m.status]}>
                {m.status === "active" ? "Active" : "Inactive"}
              </Badge>
            ),
          },
          {
            key: "effective",
            label: "Effective",
            render: (m) => `${m.effectiveFrom} → ${m.effectiveTo ?? "present"}`,
          },
          {
            key: "actions",
            label: "Actions",
            render: (m) => (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQualificationId(m.qualificationId)
                    setRtoId(m.rtoId)
                    setMStatus(m.status)
                    setEffectiveFrom(m.effectiveFrom)
                    setEffectiveTo(m.effectiveTo ?? "")
                    setEditing(m)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => removeMapping(m)}
                >
                  Remove
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add qualification → RTO mapping"
        description="Links a qualification to an RTO that can deliver it. Separate from supplier pricing."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="m-qual" className="text-sm font-medium">Qualification</label>
              <select
                id="m-qual"
                value={qualificationId}
                onChange={(e) => setQualificationId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select qualification…</option>
                {quals.map((q) => (
                  <option key={q.id} value={q.id}>
                    {qualificationLabel(q)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="m-rto" className="text-sm font-medium">RTO</label>
              <select
                id="m-rto"
                value={rtoId}
                onChange={(e) => setRtoId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select RTO…</option>
                {rtos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {rtoLabel(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="m-status" className="text-sm font-medium">Status</label>
              <select
                id="m-status"
                value={mStatus}
                onChange={(e) => setMStatus(e.target.value as "active" | "inactive")}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="m-from" className="text-sm font-medium">Effective from</label>
              <input
                id="m-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="m-to" className="text-sm font-medium">Effective to</label>
              <input
                id="m-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className={inputCls}
              />
            </div>
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
              {saving ? "Adding…" : "Add mapping"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit mapping"
        description={editing ? `${qualificationLabel(qualById.get(editing.qualificationId) ?? ({} as Qualification))} ↔ ${rtoLabel(rtoById.get(editing.rtoId) ?? ({} as Rto))}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="em-status" className="text-sm font-medium">Status</label>
              <select
                id="em-status"
                value={mStatus}
                onChange={(e) => setMStatus(e.target.value as "active" | "inactive")}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="em-from" className="text-sm font-medium">Effective from</label>
              <input
                id="em-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="em-to" className="text-sm font-medium">Effective to</label>
              <input
                id="em-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className={inputCls}
              />
            </div>
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
              {saving ? "Saving…" : "Save mapping"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
