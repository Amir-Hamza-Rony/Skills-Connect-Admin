"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createCertificateDelivery,
  listCertificateDeliveries,
  updateCertificateDelivery,
} from "@/lib/store"
import type { CertificateDelivery, CertificateDeliveryStatus } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<CertificateDeliveryStatus, "success" | "warning" | "outline" | "destructive"> = {
  pending: "warning",
  dispatched: "outline",
  delivered: "success",
  failed: "destructive",
}

const ALLOWED_NEXT: Record<CertificateDeliveryStatus, CertificateDeliveryStatus[]> = {
  pending: ["dispatched", "failed"],
  dispatched: ["delivered", "failed"],
  delivered: [],
  failed: ["pending"],
}

export function CertificateDeliveriesPage() {
  const [rows, setRows] = useState<CertificateDelivery[] | null>(null)
  const [editing, setEditing] = useState<CertificateDelivery | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const [orderIdFilter, setOrderIdFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<CertificateDeliveryStatus | "">("")
  const [orderId, setOrderId] = useState("")
  const [certificateReference, setCertificateReference] = useState("")
  const [deliveryStatus, setDeliveryStatus] = useState<CertificateDeliveryStatus>("pending")
  const [deliveryDate, setDeliveryDate] = useState("")
  const [recipient, setRecipient] = useState("")
  const [deliveryMethod, setDeliveryMethod] = useState("")
  const [trackingNumber, setTrackingNumber] = useState("")
  const [confirmationDetails, setConfirmationDetails] = useState("")
  const [deliveryNotes, setDeliveryNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listCertificateDeliveries()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((d) => {
      if (search && !(d.orderId.includes(search) || (d.certificateReference ?? "").includes(search))) return false
      if (orderIdFilter && d.orderId !== orderIdFilter) return false
      if (statusFilter && d.deliveryStatus !== statusFilter) return false
      return true
    })
  }, [rows, search, orderIdFilter, statusFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!orderId.trim()) {
      setError("Order ID is required.")
      return
    }
    setSaving(true)
    try {
      const created = await createCertificateDelivery({
        orderId: orderId.trim(),
        certificateReference: certificateReference.trim() || null,
        deliveryStatus,
        deliveryDate: deliveryDate.trim() || null,
        recipient: recipient.trim() || null,
        deliveryMethod: deliveryMethod.trim() || null,
        trackingNumber: trackingNumber.trim() || null,
        confirmationDetails: confirmationDetails.trim() || null,
        deliveryNotes: deliveryNotes.trim() || null,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setOrderId("")
      setCertificateReference("")
      setDeliveryStatus("pending")
      setDeliveryDate("")
      setRecipient("")
      setDeliveryMethod("")
      setTrackingNumber("")
      setConfirmationDetails("")
      setDeliveryNotes("")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create delivery record.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, d: CertificateDelivery) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const updated = await updateCertificateDelivery(d.id, {
        deliveryStatus,
        deliveryDate: deliveryDate.trim() || null,
        recipient: recipient.trim() || null,
        deliveryMethod: deliveryMethod.trim() || null,
        trackingNumber: trackingNumber.trim() || null,
        confirmationDetails: confirmationDetails.trim() || null,
        deliveryNotes: deliveryNotes.trim() || null,
      })
      setRows((prev) =>
        prev?.map((r_) => (r_.id === updated.id ? updated : r_)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update delivery. Invalid transition may be blocked.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading certificate deliveries" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Certificate Deliveries
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Certificate delivery tracking · {visible.length} deliveries
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Record Delivery
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search order ID or certificate reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="relative w-full md:w-48">
          <input
            type="text"
            placeholder="Filter by order ID…"
            value={orderIdFilter}
            onChange={(e) => setOrderIdFilter(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CertificateDeliveryStatus | "")}
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="dispatched">Dispatched</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <DataTable<CertificateDelivery>
        rows={visible}
        emptyMessage="No deliveries match the current filters."
        rowLabel={(d) => `Delivery ${d.id.slice(-6)}`}
        columns={[
          { key: "orderId", label: "Order ID" },
          { key: "certificateReference", label: "Certificate Ref", render: (d) => d.certificateReference ?? "—" },
          { key: "deliveryStatus", label: "Status", render: (d) => <Badge variant={STATUS_VARIANT[d.deliveryStatus]}>{d.deliveryStatus}</Badge> },
          { key: "deliveryDate", label: "Delivery Date", render: (d) => d.deliveryDate ?? "—" },
          { key: "recipient", label: "Recipient", render: (d) => d.recipient ?? "—" },
          { key: "deliveryMethod", label: "Method", render: (d) => d.deliveryMethod ?? "—" },
          { key: "trackingNumber", label: "Tracking", render: (d) => d.trackingNumber ?? "—" },
          {
            key: "actions",
            label: "Actions",
            render: (d) => {
              const next = ALLOWED_NEXT[d.deliveryStatus]
              return (
                <div className="flex items-center gap-2">
                  {next.length > 0 ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setOrderId(d.orderId)
                        setCertificateReference(d.certificateReference ?? "")
                        setDeliveryStatus(d.deliveryStatus)
                        setDeliveryDate(d.deliveryDate ?? "")
                        setRecipient(d.recipient ?? "")
                        setDeliveryMethod(d.deliveryMethod ?? "")
                        setTrackingNumber(d.trackingNumber ?? "")
                        setConfirmationDetails(d.confirmationDetails ?? "")
                        setDeliveryNotes(d.deliveryNotes ?? "")
                        setEditing(d)
                      }}
                    >
                      Update
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled>
                      Terminal
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(d)}
                  >
                    View
                  </Button>
                </div>
              )
            },
          },
        ]}
      />

      <Dialog
        open={creating || editing !== null}
        onClose={() => { setCreating(false); setEditing(null) }}
        title={creating ? "Record Certificate Delivery" : "Update Delivery"}
        description={creating ? "Record a new certificate delivery for an order." : editing ? `Order: ${editing.orderId}` : undefined}
      >
        <form onSubmit={creating ? onCreate : (e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cd-order" className="text-sm font-medium">Order ID</label>
              <input
                id="cd-order"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="Order ObjectId"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cd-status" className="text-sm font-medium">Delivery Status</label>
              <select
                id="cd-status"
                value={deliveryStatus}
                onChange={(e) => setDeliveryStatus(e.target.value as CertificateDeliveryStatus)}
                className={inputCls}
              >
                <option value="pending">Pending</option>
                <option value="dispatched">Dispatched</option>
                <option value="delivered">Delivered</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cd-ref" className="text-sm font-medium">Certificate Reference</label>
              <input
                id="cd-ref"
                value={certificateReference}
                onChange={(e) => setCertificateReference(e.target.value)}
                placeholder="CERT-2026-001"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cd-date" className="text-sm font-medium">Delivery Date</label>
              <input
                id="cd-date"
                type="datetime-local"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cd-recipient" className="text-sm font-medium">Recipient</label>
              <input
                id="cd-recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Student name"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cd-method" className="text-sm font-medium">Delivery Method</label>
              <input
                id="cd-method"
                value={deliveryMethod}
                onChange={(e) => setDeliveryMethod(e.target.value)}
                placeholder="Courier / Post / Hand"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cd-tracking" className="text-sm font-medium">Tracking Number</label>
              <input
                id="cd-tracking"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="TRK123456"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cd-confirm" className="text-sm font-medium">Confirmation Details</label>
              <input
                id="cd-confirm"
                value={confirmationDetails}
                onChange={(e) => setConfirmationDetails(e.target.value)}
                placeholder="Signed for, photo proof, etc."
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cd-notes" className="text-sm font-medium">Delivery Notes</label>
            <textarea
              id="cd-notes"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setCreating(false); setEditing(null) }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : creating ? "Record Delivery" : "Update Delivery"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
