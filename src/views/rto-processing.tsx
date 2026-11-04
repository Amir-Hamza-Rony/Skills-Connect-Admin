"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createRtoProcessing,
  deleteRtoProcessing,
  listOrders,
  listRtoProcessing,
  updateRtoProcessing,
} from "@/lib/ops-store"
import { listRtos, orderLabel, rtoLabel } from "@/lib/store"
import type { Order, Rto, RtoProcessing, RtoProcessingStatus } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<RtoProcessingStatus, "success" | "warning" | "outline" | "destructive"> = {
  "Not Started": "outline",
  "Submission Prepared": "warning",
  "Submitted to RTO": "warning",
  Acknowledged: "success",
  "Under Assessment": "warning",
  "Additional Evidence Required": "warning",
  Approved: "success",
  Issued: "success",
  Rejected: "destructive",
}

export function RtoProcessingPage() {
  const [rows, setRows] = useState<RtoProcessing[] | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [rtos, setRtos] = useState<Rto[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<RtoProcessing | null>(null)
  const [orderFilter, setOrderFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<RtoProcessingStatus | "">("")
  const [orderId, setOrderId] = useState("")
  const [rtoId, setRtoId] = useState("")
  const [submissionStatus, setSubmissionStatus] = useState<RtoProcessingStatus>("Not Started")
  const [processingStatus, setProcessingStatus] = useState<RtoProcessingStatus>("Not Started")
  const [submissionDate, setSubmissionDate] = useState("")
  const [rtoReference, setRtoReference] = useState("")
  const [processingFees, setProcessingFees] = useState("")
  const [processingCurrency, setProcessingCurrency] = useState<"AUD" | "BDT" | "USD" | "GBP" | "EUR" | "INR">("AUD")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const rtoById = useMemo(() => new Map(rtos.map((r) => [r.id, r])), [rtos])

  useEffect(() => {
    void (async () => {
      const [r, o, rt] = await Promise.all([
        listRtoProcessing(),
        listOrders(),
        listRtos(),
      ])
      setRows(r)
      setOrders(o)
      setRtos(rt)
    })()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((r) => {
      if (orderFilter && r.orderId !== orderFilter) return false
      if (statusFilter && r.processingStatus !== statusFilter) return false
      return true
    })
  }, [rows, orderFilter, statusFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!orderId || !rtoId) {
      setError("Order and RTO are required.")
      return
    }
    const fees = processingFees === "" ? null : Number(processingFees)
    if (fees !== null && (!Number.isFinite(fees) || fees < 0)) {
      setError("Processing fees must be a non-negative number.")
      return
    }
    setSaving(true)
    try {
      const created = await createRtoProcessing({
        orderId,
        rtoId,
        submissionStatus,
        submissionDate: submissionDate || null,
        processingStatus,
        rtoReference: rtoReference || null,
        processingFees: fees,
        processingCurrency,
        notes: notes || null,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setOrderId("")
      setRtoId("")
      setSubmissionStatus("Not Started")
      setProcessingStatus("Not Started")
      setSubmissionDate("")
      setRtoReference("")
      setProcessingFees("")
      setProcessingCurrency("AUD")
      setNotes("")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create RTO processing record.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, r: RtoProcessing) {
    e.preventDefault()
    setError(null)
    const fees = processingFees === "" ? null : Number(processingFees)
    if (fees !== null && (!Number.isFinite(fees) || fees < 0)) {
      setError("Processing fees must be a non-negative number.")
      return
    }
    setSaving(true)
    try {
      const updated = await updateRtoProcessing(r.id, {
        submissionStatus,
        submissionDate: submissionDate || undefined,
        processingStatus,
        rtoReference: rtoReference || undefined,
        processingFees: fees,
        processingCurrency,
        notes: notes || undefined,
      })
      setRows((prev) =>
        prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update RTO processing record.")
    } finally {
      setSaving(false)
    }
  }

  async function removeProcessing(r: RtoProcessing) {
    if (!window.confirm(`Remove RTO processing record for order ${orderById.get(r.orderId)?.id ?? r.orderId}?`)) return
    setError(null)
    setSaving(true)
    try {
      await deleteRtoProcessing(r.id)
      setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to remove RTO processing record.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading RTO processing" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const CURRENCIES: Array<{ value: string; label: string }> = [
    { value: "AUD", label: "AUD" },
    { value: "BDT", label: "BDT" },
    { value: "USD", label: "USD" },
    { value: "GBP", label: "GBP" },
    { value: "EUR", label: "EUR" },
    { value: "INR", label: "INR" },
  ]

  const STATUSES: RtoProcessingStatus[] = [
    "Not Started",
    "Submission Prepared",
    "Submitted to RTO",
    "Acknowledged",
    "Under Assessment",
    "Additional Evidence Required",
    "Approved",
    "Issued",
    "Rejected",
  ]

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            RTO Processing
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            RTO submission and processing tracking per order · {visible.length} records
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add record
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <select
            value={orderFilter}
            onChange={(e) => setOrderFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">All orders</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {orderLabel(o)}
              </option>
            ))}
          </select>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RtoProcessingStatus | "")}
          className={inputCls}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <DataTable<RtoProcessing>
        rows={visible}
        emptyMessage="No RTO processing records match the current filters."
        rowLabel={(r) => orderById.get(r.orderId)?.id ?? r.orderId}
        columns={[
          {
            key: "order",
            label: "Order",
            render: (r) => orderLabel(orderById.get(r.orderId) ?? ({} as Order)),
          },
          {
            key: "rto",
            label: "RTO",
            render: (r) => rtoLabel(rtoById.get(r.rtoId) ?? ({} as Rto)),
          },
          {
            key: "submission",
            label: "Submission",
            render: (r) => `${r.submissionStatus} · ${r.submissionDate ?? "—"}`,
          },
          {
            key: "processing",
            label: "Processing",
            render: (r) => (
              <Badge variant={STATUS_VARIANT[r.processingStatus]}>
                {r.processingStatus}
              </Badge>
            ),
          },
          {
            key: "fees",
            label: "Fees",
            render: (r) =>
              r.processingFees !== null
                ? `${r.processingFees} ${r.processingCurrency ?? "AUD"}`
                : "—",
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
                    setOrderId(r.orderId)
                    setRtoId(r.rtoId)
                    setSubmissionStatus(r.submissionStatus)
                    setProcessingStatus(r.processingStatus)
                    setSubmissionDate(r.submissionDate ?? "")
                    setRtoReference(r.rtoReference ?? "")
                    setProcessingFees(String(r.processingFees ?? ""))
                    setProcessingCurrency(r.processingCurrency ?? "AUD")
                    setNotes(r.notes ?? "")
                    setEditing(r)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => removeProcessing(r)}
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
        title="Add RTO processing record"
        description="Tracks RTO submission and processing for a single order."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rp-order" className="text-sm font-medium">Order</label>
              <select
                id="rp-order"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {orderLabel(o)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-rto" className="text-sm font-medium">RTO</label>
              <select
                id="rp-rto"
                value={rtoId}
                onChange={(e) => setRtoId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select RTO…</option>
                {rtos.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rtoLabel(rt)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rp-sub-status" className="text-sm font-medium">Submission status</label>
              <select
                id="rp-sub-status"
                value={submissionStatus}
                onChange={(e) => setSubmissionStatus(e.target.value as RtoProcessingStatus)}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-proc-status" className="text-sm font-medium">Processing status</label>
              <select
                id="rp-proc-status"
                value={processingStatus}
                onChange={(e) => setProcessingStatus(e.target.value as RtoProcessingStatus)}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rp-sub-date" className="text-sm font-medium">Submission date</label>
              <input
                id="rp-sub-date"
                type="date"
                value={submissionDate}
                onChange={(e) => setSubmissionDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-ref" className="text-sm font-medium">RTO reference</label>
              <input
                id="rp-ref"
                value={rtoReference}
                onChange={(e) => setRtoReference(e.target.value)}
                placeholder="RTO-12345"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rp-fees" className="text-sm font-medium">Processing fees</label>
              <input
                id="rp-fees"
                type="number"
                min="0"
                step="0.01"
                value={processingFees}
                onChange={(e) => setProcessingFees(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rp-currency" className="text-sm font-medium">Currency</label>
              <select
                id="rp-currency"
                value={processingCurrency}
                onChange={(e) => setProcessingCurrency(e.target.value as any)}
                className={inputCls}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rp-notes" className="text-sm font-medium">Notes</label>
            <input
              id="rp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Processing notes…"
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
              {saving ? "Adding…" : "Add record"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit RTO processing record"
        description={editing ? `Order: ${orderLabel(orderById.get(editing.orderId) ?? ({} as Order))}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="erp-sub-status" className="text-sm font-medium">Submission status</label>
              <select
                id="erp-sub-status"
                value={submissionStatus}
                onChange={(e) => setSubmissionStatus(e.target.value as RtoProcessingStatus)}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="erp-proc-status" className="text-sm font-medium">Processing status</label>
              <select
                id="erp-proc-status"
                value={processingStatus}
                onChange={(e) => setProcessingStatus(e.target.value as RtoProcessingStatus)}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="erp-sub-date" className="text-sm font-medium">Submission date</label>
              <input
                id="erp-sub-date"
                type="date"
                value={submissionDate}
                onChange={(e) => setSubmissionDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="erp-ref" className="text-sm font-medium">RTO reference</label>
              <input
                id="erp-ref"
                value={rtoReference}
                onChange={(e) => setRtoReference(e.target.value)}
                placeholder="RTO-12345"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="erp-fees" className="text-sm font-medium">Processing fees</label>
              <input
                id="erp-fees"
                type="number"
                min="0"
                step="0.01"
                value={processingFees}
                onChange={(e) => setProcessingFees(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="erp-currency" className="text-sm font-medium">Currency</label>
              <select
                id="erp-currency"
                value={processingCurrency}
                onChange={(e) => setProcessingCurrency(e.target.value as any)}
                className={inputCls}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="erp-notes" className="text-sm font-medium">Notes</label>
            <input
              id="erp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Processing notes…"
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
              {saving ? "Saving…" : "Save record"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
