"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createRplPartner,
  listRplPartners,
  rplPartnerLabel,
  updateRplPartner,
} from "@/lib/store"
import type { RplPartner, RplPartnerStatus } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<RplPartnerStatus, "success" | "outline"> = {
  active: "success",
  inactive: "outline",
}

export function RplPartnersPage() {
  const [rows, setRows] = useState<RplPartner[] | null>(null)
  const [viewing, setViewing] = useState<RplPartner | null>(null)
  const [editing, setEditing] = useState<RplPartner | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<RplPartnerStatus | "">("")
  const [partnerCode, setPartnerCode] = useState("")
  const [legalName, setLegalName] = useState("")
  const [tradingName, setTradingName] = useState("")
  const [contactPerson, setContactPerson] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [status, setStatus] = useState<RplPartnerStatus>("active")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listRplPartners()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((p) => {
      if (search && !rplPartnerLabel(p).toLowerCase().includes(search.toLowerCase())) return false
      if (statusFilter && p.status !== statusFilter) return false
      return true
    })
  }, [rows, search, statusFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!partnerCode.trim() || !legalName.trim()) {
      setError("Partner code and legal name are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createRplPartner({
        partnerCode: partnerCode.trim().toUpperCase(),
        legalName: legalName.trim(),
        tradingName: tradingName.trim() || null,
        contactPerson: contactPerson.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        status,
        notes: notes.trim() || null,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setPartnerCode("")
      setLegalName("")
      setTradingName("")
      setContactPerson("")
      setEmail("")
      setPhone("")
      setAddress("")
      setStatus("active")
      setNotes("")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create RPL partner. The code may already exist.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, p: RplPartner) {
    e.preventDefault()
    setError(null)
    if (!partnerCode.trim() || !legalName.trim()) {
      setError("Partner code and legal name are required.")
      return
    }
    setSaving(true)
    try {
      const updated = await updateRplPartner(p.id, {
        partnerCode: partnerCode.trim(),
        legalName: legalName.trim(),
        tradingName: tradingName.trim() || null,
        contactPerson: contactPerson.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        status,
        notes: notes.trim() || null,
      })
      setRows((prev) =>
        prev?.map((r_) => (r_.id === updated.id ? updated : r_)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update RPL partner. The code may already exist.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(p: RplPartner) {
    setError(null)
    setSaving(true)
    try {
      const next: RplPartnerStatus = p.status === "active" ? "inactive" : "active"
      const updated = await updateRplPartner(p.id, { status: next })
      setRows((prev) =>
        prev?.map((r_) => (r_.id === updated.id ? updated : r_)) ?? null,
      )
      if (viewing?.id === p.id) setViewing(updated)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update partner status.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading RPL partners" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            RPL Partners
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            RPL Partner directory · {visible.length} partners
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add Partner
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search partner name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RplPartnerStatus | "")}
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable<RplPartner>
        rows={visible}
        emptyMessage="No partners match the current filters."
        rowLabel={rplPartnerLabel}
        columns={[
          { key: "partnerCode", label: "Partner code" },
          { key: "legalName", label: "Legal name" },
          { key: "tradingName", label: "Trading name", render: (p) => p.tradingName ?? "—" },
          { key: "contactPerson", label: "Contact", render: (p) => p.contactPerson ?? "—" },
          { key: "email", label: "Email", render: (p) => p.email ?? "—" },
          { key: "phone", label: "Phone", render: (p) => p.phone ?? "—" },
          {
            key: "status",
            label: "Status",
            render: (p) => (
              <Badge variant={STATUS_VARIANT[p.status]}>
                {p.status === "active" ? "Active" : "Inactive"}
              </Badge>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (p) => (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPartnerCode(p.partnerCode)
                    setLegalName(p.legalName)
                    setTradingName(p.tradingName ?? "")
                    setContactPerson(p.contactPerson ?? "")
                    setEmail(p.email ?? "")
                    setPhone(p.phone ?? "")
                    setAddress(p.address ?? "")
                    setStatus(p.status)
                    setNotes(p.notes ?? "")
                    setEditing(p)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant={p.status === "active" ? "destructive" : "default"}
                  onClick={() => toggleStatus(p)}
                >
                  {p.status === "active" ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setViewing(p)}
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
        title="Add RPL Partner"
        description="Partner codes are normalized to uppercase and must be unique."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rp-code" className="text-sm font-medium">Partner code</label>
              <input
                id="rp-code"
                value={partnerCode}
                onChange={(e) => setPartnerCode(e.target.value)}
                placeholder="RPL-001"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-status" className="text-sm font-medium">Status</label>
              <select
                id="rp-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as RplPartnerStatus)}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rp-legal" className="text-sm font-medium">Legal name</label>
            <input
              id="rp-legal"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Acme Training Partners Pty Ltd"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rp-trading" className="text-sm font-medium">Trading name</label>
              <input
                id="rp-trading"
                value={tradingName}
                onChange={(e) => setTradingName(e.target.value)}
                placeholder="Acme Training"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-contact" className="text-sm font-medium">Contact person</label>
              <input
                id="rp-contact"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder="Jane Smith"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rp-email" className="text-sm font-medium">Email</label>
              <input
                id="rp-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@acme.example.com"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-phone" className="text-sm font-medium">Phone</label>
              <input
                id="rp-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0400 000 000"
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rp-address" className="text-sm font-medium">Address</label>
            <input
              id="rp-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Training Rd, Suburb, State 4000"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rp-notes" className="text-sm font-medium">Notes</label>
            <textarea
              id="rp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add Partner"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit RPL Partner"
        description={editing ? `Code: ${editing.partnerCode}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="erp-code" className="text-sm font-medium">Partner code</label>
              <input
                id="erp-code"
                value={partnerCode}
                onChange={(e) => setPartnerCode(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="erp-status" className="text-sm font-medium">Status</label>
              <select
                id="erp-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as RplPartnerStatus)}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="erp-legal" className="text-sm font-medium">Legal name</label>
            <input
              id="erp-legal"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="erp-trading" className="text-sm font-medium">Trading name</label>
              <input
                id="erp-trading"
                value={tradingName}
                onChange={(e) => setTradingName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="erp-contact" className="text-sm font-medium">Contact person</label>
              <input
                id="erp-contact"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="erp-email" className="text-sm font-medium">Email</label>
              <input
                id="erp-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="erp-phone" className="text-sm font-medium">Phone</label>
              <input
                id="erp-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="erp-address" className="text-sm font-medium">Address</label>
            <input
              id="erp-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="erp-notes" className="text-sm font-medium">Notes</label>
            <textarea
              id="erp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Partner"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? rplPartnerLabel(viewing) : "RPL Partner"}
        description={viewing?.legalName}
      >
        {viewing && (
          <div className="space-y-3 text-sm">
            <p><strong>Partner code:</strong> {viewing.partnerCode}</p>
            <p><strong>Legal name:</strong> {viewing.legalName}</p>
            <p><strong>Trading name:</strong> {viewing.tradingName ?? "—"}</p>
            <p><strong>Contact person:</strong> {viewing.contactPerson ?? "—"}</p>
            <p><strong>Email:</strong> {viewing.email ?? "—"}</p>
            <p><strong>Phone:</strong> {viewing.phone ?? "—"}</p>
            <p><strong>Address:</strong> {viewing.address ?? "—"}</p>
            <p><strong>Status:</strong> {viewing.status === "active" ? "Active" : "Inactive"}</p>
            {viewing.notes && <p><strong>Notes:</strong> {viewing.notes}</p>}
            <p><strong>Created:</strong> {viewing.createdAt}</p>
            <p><strong>Updated:</strong> {viewing.updatedAt}</p>
          </div>
        )}
      </Dialog>
    </div>
  )
}
