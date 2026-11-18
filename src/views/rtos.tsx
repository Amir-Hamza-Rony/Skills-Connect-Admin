"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { createRto, listRtos, rtoLabel, updateRto } from "@/lib/store"
import type { Rto, RtoStatus, RtoAccreditationStatus } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<RtoStatus, "success" | "warning" | "destructive" | "outline"> = {
  active: "success",
  "at-risk": "warning",
  suspended: "destructive",
  inactive: "outline",
}

const ACCREDITATION_VARIANT: Record<RtoAccreditationStatus, "success" | "warning" | "destructive" | "outline"> = {
  accredited: "success",
  expiring: "warning",
  expired: "destructive",
  pending: "outline",
  suspended: "destructive",
}

function accreditationVariant(status: RtoAccreditationStatus | null): "success" | "warning" | "destructive" | "outline" | "secondary" {
  if (!status) return "secondary"
  return ACCREDITATION_VARIANT[status]
}

export function RtosPage() {
  const [rows, setRows] = useState<Rto[] | null>(null)
  const [viewing, setViewing] = useState<Rto | null>(null)
  const [editing, setEditing] = useState<Rto | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<RtoStatus | "">("")
  const [legalName, setLegalName] = useState("")
  const [tradingName, setTradingName] = useState("")
  const [rtoCode, setRtoCode] = useState("")
  const [status, setStatus] = useState<RtoStatus>("active")
  const [website, setWebsite] = useState("")
  const [accreditationNumber, setAccreditationNumber] = useState("")
  const [accreditationBody, setAccreditationBody] = useState("")
  const [accreditationExpiry, setAccreditationExpiry] = useState("")
  const [accreditationStatus, setAccreditationStatus] = useState<RtoAccreditationStatus | null>(null)
  const [accreditationNotes, setAccreditationNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listRtos()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((r) => {
      if (search && !rtoLabel(r).toLowerCase().includes(search.toLowerCase())) return false
      if (statusFilter && r.status !== statusFilter) return false
      return true
    })
  }, [rows, search, statusFilter])

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
        complianceNote: "",
        website: website.trim() || "",
        accreditationNumber: accreditationNumber.trim() || null,
        accreditationBody: accreditationBody.trim() || null,
        accreditationExpiry: accreditationExpiry.trim() || null,
        accreditationStatus: accreditationStatus ?? undefined,
        supportingDocumentIds: [],
        accreditationNotes: accreditationNotes.trim() || null,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setLegalName("")
      setTradingName("")
      setRtoCode("")
      setStatus("active")
      setWebsite("")
      setAccreditationNumber("")
      setAccreditationBody("")
      setAccreditationExpiry("")
      setAccreditationStatus(null)
      setAccreditationNotes("")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create RTO. The code may already exist.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, r: Rto) {
    e.preventDefault()
    setError(null)
    if (!legalName.trim() || !tradingName.trim() || !rtoCode.trim()) {
      setError("Legal name, trading name, and RTO code are required.")
      return
    }
    setSaving(true)
    try {
      const updated = await updateRto(r.id, {
        legalName: legalName.trim(),
        tradingName: tradingName.trim(),
        rtoCode: rtoCode.trim().toUpperCase(),
        status,
        website: website.trim() || "",
        accreditationNumber: accreditationNumber.trim() || null,
        accreditationBody: accreditationBody.trim() || null,
        accreditationExpiry: accreditationExpiry.trim() || null,
        accreditationStatus: accreditationStatus ?? undefined,
        supportingDocumentIds: [],
        accreditationNotes: accreditationNotes.trim() || null,
      })
      setRows((prev) =>
        prev?.map((r_) => (r_.id === updated.id ? updated : r_)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update RTO. The code may already exist.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(r: Rto) {
    setError(null)
    setSaving(true)
    try {
      const next: RtoStatus =
        r.status === "active" ? "inactive" : "active"
      const updated = await updateRto(r.id, { status: next })
      setRows((prev) =>
        prev?.map((r_) => (r_.id === updated.id ? updated : r_)) ?? null,
      )
      if (viewing?.id === r.id) setViewing(updated)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update RTO status.")
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
            Provider directory · {visible.length} providers
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add RTO
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search trading name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RtoStatus | "")}
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="at-risk">At risk</option>
          <option value="suspended">Suspended</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable<Rto>
        rows={visible}
        emptyMessage="No providers match the current filters."
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
            key: "accreditation",
            label: "Accreditation",
            render: (r) => (
              <Badge variant={accreditationVariant(r.accreditationStatus ?? null)}>
                {r.accreditationStatus ? r.accreditationStatus[0].toUpperCase() + r.accreditationStatus.slice(1) : "—"}
              </Badge>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (r) => (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLegalName(r.legalName)
                    setTradingName(r.tradingName)
                    setRtoCode(r.rtoCode)
                    setStatus(r.status)
                    setWebsite(r.website ?? "")
                    setAccreditationNumber(r.accreditationNumber ?? "")
                    setAccreditationBody(r.accreditationBody ?? "")
                    setAccreditationExpiry(r.accreditationExpiry ?? "")
                    setAccreditationStatus(r.accreditationStatus ?? null)
                    setAccreditationNotes(r.accreditationNotes ?? "")
                    setEditing(r)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant={r.status === "active" ? "destructive" : "default"}
                  onClick={() => toggleStatus(r)}
                >
                  {r.status === "active" ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setViewing(r)}
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
        title="Add RTO / college"
        description="Provider record — qualifications attach via the Pricing module."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="rto-legal" className="text-sm font-medium">Legal name</label>
            <input
              id="rto-legal"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Demo Skills College Pty Ltd"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rto-trading" className="text-sm font-medium">Trading name</label>
              <input
                id="rto-trading"
                value={tradingName}
                onChange={(e) => setTradingName(e.target.value)}
                placeholder="Demo Skills College"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rto-code" className="text-sm font-medium">RTO code</label>
              <input
                id="rto-code"
                value={rtoCode}
                onChange={(e) => setRtoCode(e.target.value)}
                placeholder="DEMO4"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rto-status" className="text-sm font-medium">Status</label>
              <select
                id="rto-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as RtoStatus)}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="at-risk">At risk</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rto-web" className="text-sm font-medium">Website</label>
              <input
                id="rto-web"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://…"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rto-accred-no" className="text-sm font-medium">Accreditation Number</label>
              <input
                id="rto-accred-no"
                value={accreditationNumber}
                onChange={(e) => setAccreditationNumber(e.target.value)}
                placeholder="RTO12345"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rto-accred-body" className="text-sm font-medium">Accreditation Body</label>
              <input
                id="rto-accred-body"
                value={accreditationBody}
                onChange={(e) => setAccreditationBody(e.target.value)}
                placeholder="ASQA"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rto-accred-expiry" className="text-sm font-medium">Accreditation Expiry</label>
              <input
                id="rto-accred-expiry"
                type="date"
                value={accreditationExpiry}
                onChange={(e) => setAccreditationExpiry(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rto-accred-status" className="text-sm font-medium">Accreditation Status</label>
              <select
                id="rto-accred-status"
                value={accreditationStatus ?? ""}
                onChange={(e) => setAccreditationStatus((e.target.value as RtoAccreditationStatus) || null)}
                className={inputCls}
              >
                <option value="">Not set</option>
                <option value="accredited">Accredited</option>
                <option value="expiring">Expiring</option>
                <option value="expired">Expired</option>
                <option value="pending">Pending</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rto-accred-notes" className="text-sm font-medium">Accreditation Notes</label>
            <textarea
              id="rto-accred-notes"
              value={accreditationNotes}
              onChange={(e) => setAccreditationNotes(e.target.value)}
              rows={2}
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
              {saving ? "Adding…" : "Add RTO"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit RTO / college"
        description={editing ? `Code: ${editing.rtoCode}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="er-legal" className="text-sm font-medium">Legal name</label>
            <input
              id="er-legal"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Demo Skills College Pty Ltd"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="er-trading" className="text-sm font-medium">Trading name</label>
              <input
                id="er-trading"
                value={tradingName}
                onChange={(e) => setTradingName(e.target.value)}
                placeholder="Demo Skills College"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="er-code" className="text-sm font-medium">RTO code</label>
              <input
                id="er-code"
                value={rtoCode}
                onChange={(e) => setRtoCode(e.target.value)}
                placeholder="DEMO4"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="er-status" className="text-sm font-medium">Status</label>
              <select
                id="er-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as RtoStatus)}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="at-risk">At risk</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="er-web" className="text-sm font-medium">Website</label>
              <input
                id="er-web"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://…"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="er-accred-no" className="text-sm font-medium">Accreditation Number</label>
              <input
                id="er-accred-no"
                value={accreditationNumber}
                onChange={(e) => setAccreditationNumber(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="er-accred-body" className="text-sm font-medium">Accreditation Body</label>
              <input
                id="er-accred-body"
                value={accreditationBody}
                onChange={(e) => setAccreditationBody(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="er-accred-expiry" className="text-sm font-medium">Accreditation Expiry</label>
              <input
                id="er-accred-expiry"
                type="date"
                value={accreditationExpiry}
                onChange={(e) => setAccreditationExpiry(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="er-accred-status" className="text-sm font-medium">Accreditation Status</label>
              <select
                id="er-accred-status"
                value={accreditationStatus ?? ""}
                onChange={(e) => setAccreditationStatus((e.target.value as RtoAccreditationStatus) || null)}
                className={inputCls}
              >
                <option value="">Not set</option>
                <option value="accredited">Accredited</option>
                <option value="expiring">Expiring</option>
                <option value="expired">Expired</option>
                <option value="pending">Pending</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="er-accred-notes" className="text-sm font-medium">Accreditation Notes</label>
            <textarea
              id="er-accred-notes"
              value={accreditationNotes}
              onChange={(e) => setAccreditationNotes(e.target.value)}
              rows={2}
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
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save RTO"}
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
            <p className="text-muted-foreground">{viewing.complianceNote ?? "No compliance note recorded."}</p>
            <p>
              Website:{" "}
              <span className="text-muted-foreground">{viewing.website ?? "—"}</span>
            </p>
            {viewing.accreditationNumber || viewing.accreditationBody || viewing.accreditationStatus && (
              <div className="space-y-1 pt-2 border-t">
                <h4 className="font-semibold text-sm">Accreditation</h4>
                <p><strong>Number:</strong> {viewing.accreditationNumber ?? "—"}</p>
                <p><strong>Body:</strong> {viewing.accreditationBody ?? "—"}</p>
                <p><strong>Expiry:</strong> {viewing.accreditationExpiry ?? "—"}</p>
                <p><strong>Last Audit:</strong> {viewing.lastAuditDate ?? "—"}</p>
                <p><strong>Status:</strong> <Badge variant={accreditationVariant(viewing.accreditationStatus ?? null)}>{viewing.accreditationStatus ? viewing.accreditationStatus[0].toUpperCase() + viewing.accreditationStatus.slice(1) : "—"}</Badge></p>
                {viewing.accreditationNotes && <p><strong>Notes:</strong> {viewing.accreditationNotes}</p>}
              </div>
            )}
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
