"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createQualification,
  listQualifications,
  qualificationLabel,
  updateQualification,
} from "@/lib/store"
import type { Qualification, QualificationStatus } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<QualificationStatus, "success" | "warning"> = {
  current: "success",
  superseded: "warning",
}

export function QualificationsPage() {
  const [rows, setRows] = useState<Qualification[] | null>(null)
  const [viewing, setViewing] = useState<Qualification | null>(null)
  const [editing, setEditing] = useState<Qualification | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<QualificationStatus | "">("")
  const [code, setCode] = useState("")
  const [title, setTitle] = useState("")
  const [pkg, setPkg] = useState("")
  const [industry, setIndustry] = useState("")
  const [status, setStatus] = useState<QualificationStatus>("current")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listQualifications()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((q) => {
      if (search && !qualificationLabel(q).toLowerCase().includes(search.toLowerCase())) return false
      if (statusFilter && q.status !== statusFilter) return false
      return true
    })
  }, [rows, search, statusFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!code.trim() || !title.trim() || !pkg.trim() || !industry.trim()) {
      setError("Code, title, training package, and industry are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createQualification({
        code: code.trim().toUpperCase(),
        title: title.trim(),
        trainingPackage: pkg.trim(),
        industry: industry.trim(),
        status,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setCode("")
      setTitle("")
      setPkg("")
      setIndustry("")
      setStatus("current")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create qualification. The code may already exist.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, q: Qualification) {
    e.preventDefault()
    setError(null)
    if (!code.trim() || !title.trim() || !pkg.trim() || !industry.trim()) {
      setError("Code, title, training package, and industry are required.")
      return
    }
    setSaving(true)
    try {
      const updated = await updateQualification(q.id, {
        code: code.trim().toUpperCase(),
        title: title.trim(),
        trainingPackage: pkg.trim(),
        industry: industry.trim(),
        status,
      })
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update qualification. The code may already exist.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(q: Qualification) {
    setError(null)
    setSaving(true)
    try {
      const updated = await updateQualification(q.id, {
        status: q.status === "current" ? "superseded" : "current",
      })
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
      if (viewing?.id === q.id) setViewing(updated)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update qualification status.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading qualifications" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Qualifications
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Catalogue and licensing references · {visible.length} qualifications
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add qualification
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search code or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as QualificationStatus | "")}
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="current">Current</option>
          <option value="superseded">Superseded</option>
        </select>
      </div>

      <DataTable<Qualification>
        rows={visible}
        emptyMessage="No qualifications match the current filters."
        rowLabel={qualificationLabel}
        columns={[
          { key: "code", label: "Code" },
          { key: "title", label: "Title" },
          { key: "trainingPackage", label: "Training package" },
          { key: "industry", label: "Industry" },
          {
            key: "status",
            label: "Status",
            render: (q) => (
              <Badge variant={STATUS_VARIANT[q.status]}>
                {q.status === "current" ? "Current" : "Superseded"}
              </Badge>
            ),
          },
          {
            key: "licensing",
            label: "Licensing refs",
            render: (q) => (
              <Badge variant="secondary">{q.licensingRefs.length}</Badge>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (q) => (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCode(q.code)
                    setTitle(q.title)
                    setPkg(q.trainingPackage)
                    setIndustry(q.industry)
                    setStatus(q.status)
                    setEditing(q)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant={q.status === "current" ? "destructive" : "default"}
                  onClick={() => toggleStatus(q)}
                >
                  {q.status === "current" ? "Supersede" : "Activate"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setViewing(q)}
                >
                  View
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add qualification"
        description="Catalogue entry — supplier pricing attaches in the Pricing module."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="q-code" className="text-sm font-medium">Code</label>
              <input
                id="q-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="AUR32120"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="q-status" className="text-sm font-medium">Status</label>
              <select
                id="q-status"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as QualificationStatus)
                }
                className={inputCls}
              >
                <option value="current">Current</option>
                <option value="superseded">Superseded</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="q-title" className="text-sm font-medium">Title</label>
            <input
              id="q-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Certificate III in…"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="q-pkg" className="text-sm font-medium">
                Training package
              </label>
              <input
                id="q-pkg"
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
                placeholder="AUR Automotive…"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="q-ind" className="text-sm font-medium">Industry</label>
              <input
                id="q-ind"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Automotive"
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
              {saving ? "Adding…" : "Add qualification"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit qualification"
        description={editing ? `Code: ${editing.code}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="eq-code" className="text-sm font-medium">Code</label>
              <input
                id="eq-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="AUR32120"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="eq-status" className="text-sm font-medium">Status</label>
              <select
                id="eq-status"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as QualificationStatus)
                }
                className={inputCls}
              >
                <option value="current">Current</option>
                <option value="superseded">Superseded</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="eq-title" className="text-sm font-medium">Title</label>
            <input
              id="eq-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Certificate III in…"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="eq-pkg" className="text-sm font-medium">
                Training package
              </label>
              <input
                id="eq-pkg"
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
                placeholder="AUR Automotive…"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="eq-ind" className="text-sm font-medium">Industry</label>
              <input
                id="eq-ind"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Automotive"
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
              {saving ? "Saving…" : "Save qualification"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? qualificationLabel(viewing) : "Qualification"}
        description={viewing ? `${viewing.trainingPackage} · ${viewing.industry}` : undefined}
      >
        <h3 className="pb-2 text-sm font-medium">Licensing & skills assessment</h3>
        {!viewing || viewing.licensingRefs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No licensing references recorded for this qualification.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {viewing.licensingRefs.map((ref, i) => (
              <li key={i} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{ref.authority}</p>
                <p className="text-muted-foreground">Industry: {ref.industry}</p>
                <p className="text-muted-foreground">Prerequisites: {ref.prerequisites}</p>
                <p className="text-muted-foreground">Outcome: {ref.outcome}</p>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  )
}
