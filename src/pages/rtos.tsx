import { useEffect, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { createRto, listRtos, rtoLabel } from "@/lib/store"
import type { Rto, RtoStatus } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<RtoStatus, "success" | "warning" | "destructive" | "outline"> = {
  active: "success",
  "at-risk": "warning",
  suspended: "destructive",
  inactive: "outline",
}

export function RtosPage() {
  const [rows, setRows] = useState<Rto[] | null>(null)
  const [viewing, setViewing] = useState<Rto | null>(null)
  const [creating, setCreating] = useState(false)
  const [legalName, setLegalName] = useState("")
  const [tradingName, setTradingName] = useState("")
  const [rtoCode, setRtoCode] = useState("")
  const [status, setStatus] = useState<RtoStatus>("active")
  const [website, setWebsite] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listRtos()))()
  }, [])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!legalName.trim() || !tradingName.trim() || !rtoCode.trim()) {
      setError("Legal name, trading name, and RTO code are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createRto({
        legalName: legalName.trim(),
        tradingName: tradingName.trim(),
        rtoCode: rtoCode.trim().toUpperCase(),
        cricosCode: null,
        contacts: [],
        status,
        complianceNote: "Preview record — verify against training.gov.au at migration.",
        website: website.trim() || "https://example.invalid",
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setLegalName("")
      setTradingName("")
      setRtoCode("")
      setStatus("active")
      setWebsite("")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading RTOs" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            RTOs & Colleges
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Provider directory · {rows.length} providers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">Preview data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add RTO
          </Button>
        </div>
      </div>

      <DataTable<Rto>
        rows={rows}
        emptyMessage="No providers yet — add the first one."
        rowLabel={rtoLabel}
        columns={[
          { key: "tradingName", label: "Trading name" },
          { key: "rtoCode", label: "RTO code" },
          { key: "cricosCode", label: "CRICOS", render: (r) => r.cricosCode ?? "—" },
          {
            key: "status",
            label: "Status",
            render: (r) => (
              <Badge variant={STATUS_VARIANT[r.status]}>
                {r.status === "at-risk" ? "At risk" : r.status[0].toUpperCase() + r.status.slice(1)}
              </Badge>
            ),
          },
          {
            key: "contacts",
            label: "Contacts",
            render: (r) => <Badge variant="secondary">{r.contacts.length}</Badge>,
          },
          {
            key: "actions",
            label: "Actions",
            render: (r) => (
              <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                View
              </Button>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add RTO / college"
        description="Provider record — qualifications attach via the Pricing module."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="rto-legal" className="text-sm font-medium">Legal name</label>
            <input id="rto-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Demo Skills College Pty Ltd" className={inputCls} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rto-trading" className="text-sm font-medium">Trading name</label>
              <input id="rto-trading" value={tradingName} onChange={(e) => setTradingName(e.target.value)} placeholder="Demo Skills College" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rto-code" className="text-sm font-medium">RTO code</label>
              <input id="rto-code" value={rtoCode} onChange={(e) => setRtoCode(e.target.value)} placeholder="DEMO4" className={inputCls} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rto-status" className="text-sm font-medium">Status</label>
              <select id="rto-status" value={status} onChange={(e) => setStatus(e.target.value as RtoStatus)} className={inputCls}>
                <option value="active">Active</option>
                <option value="at-risk">At risk</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rto-web" className="text-sm font-medium">Website</label>
              <input id="rto-web" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className={inputCls} />
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
              {saving ? "Adding…" : "Add RTO"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? rtoLabel(viewing) : "RTO"}
        description={viewing?.legalName}
      >
        {viewing && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{viewing.complianceNote}</p>
            <p>
              Website:{" "}
              <span className="text-muted-foreground">{viewing.website}</span>
            </p>
            <h3 className="font-medium">Contacts ({viewing.contacts.length})</h3>
            {viewing.contacts.length === 0 ? (
              <p className="text-muted-foreground">No contacts recorded.</p>
            ) : (
              <ul className="space-y-2">
                {viewing.contacts.map((c, i) => (
                  <li key={i} className="rounded-lg border p-3">
                    <p className="font-medium">{c.name} · {c.role}</p>
                    <p className="text-muted-foreground">{c.email} · {c.phone}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}
