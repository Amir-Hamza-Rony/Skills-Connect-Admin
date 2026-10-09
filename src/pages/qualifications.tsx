import { useEffect, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { createQualification, listQualifications, qualificationLabel } from "@/lib/store"
import type { Qualification, QualificationStatus } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

export function QualificationsPage() {
  const [rows, setRows] = useState<Qualification[] | null>(null)
  const [viewing, setViewing] = useState<Qualification | null>(null)
  const [creating, setCreating] = useState(false)
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
            Catalogue and licensing references · {rows.length} qualifications
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">Preview data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add qualification
          </Button>
        </div>
      </div>

      <DataTable<Qualification>
        rows={rows}
        emptyMessage="No qualifications yet — add the first one."
        rowLabel={qualificationLabel}
        columns={[
          { key: "code", label: "Code" },
          { key: "title", label: "Title" },
          { key: "trainingPackage", label: "Training package" },
          { key: "industry", label: "Industry" },
          {
            key: "status",
            label: "Status",
            render: (q) =>
              q.status === "current" ? (
                <Badge variant="success">Current</Badge>
              ) : (
                <Badge variant="warning">Superseded</Badge>
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
              <Button size="sm" variant="outline" onClick={() => setViewing(q)}>
                View
              </Button>
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
              <input id="q-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AUR32120" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="q-status" className="text-sm font-medium">Status</label>
              <select id="q-status" value={status} onChange={(e) => setStatus(e.target.value as QualificationStatus)} className={inputCls}>
                <option value="current">Current</option>
                <option value="superseded">Superseded</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="q-title" className="text-sm font-medium">Title</label>
            <input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Certificate III in…" className={inputCls} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="q-pkg" className="text-sm font-medium">Training package</label>
              <input id="q-pkg" value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="AUR Automotive…" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="q-ind" className="text-sm font-medium">Industry</label>
              <input id="q-ind" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Automotive" className={inputCls} />
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
              {saving ? "Adding…" : "Add qualification"}
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
