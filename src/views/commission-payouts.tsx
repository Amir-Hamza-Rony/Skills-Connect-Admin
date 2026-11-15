"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createCommissionPayout,
  listCommissionPayouts,
} from "@/lib/store"
import type { CommissionPayout } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline" | "destructive"> = {
  pending: "warning",
  paid: "success",
  failed: "destructive",
}

export function CommissionPayoutsPage() {
  const [rows, setRows] = useState<CommissionPayout[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [recordId, setRecordId] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState<"AUD" | "BDT" | "USD" | "GBP" | "EUR" | "INR">("BDT")
  const [paymentDate, setPaymentDate] = useState("")
  const [paymentReference, setPaymentReference] = useState("")
  const [statusFilter, setStatusFilter] = useState<"pending" | "paid" | "failed" | "">("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listCommissionPayouts()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((p) => !statusFilter || p.status === statusFilter)
  }, [rows, statusFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!recordId || !amount) {
      setError("Commission record and amount are required.")
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be a positive number.")
      return
    }
    setSaving(true)
    try {
      await createCommissionPayout({
        commissionRecordId: recordId,
        amount: amt,
        currency,
        paymentDate: paymentDate || undefined,
        paymentReference: paymentReference || undefined,
      })
      setRows(await listCommissionPayouts())
      setCreating(false)
      setRecordId("")
      setAmount("")
      setCurrency("BDT")
      setPaymentDate("")
      setPaymentReference("")
    } catch (err: any) {
      setError(err?.message ?? "Failed to record payout. It may already be paid out.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading commission payouts" />
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

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Commission Payouts
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Recorded payouts for approved commission records · {visible.length} payouts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Record payout
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <DataTable<CommissionPayout>
        rows={visible}
        emptyMessage="No commission payouts match the current filters."
        rowLabel={(p) => p.commissionRecordId}
        columns={[
          { key: "commissionRecordId", label: "Commission record" },
          { key: "amount", label: "Amount", render: (p) => `${p.amount} ${p.currency}` },
          {
            key: "paymentDate",
            label: "Payment date",
            render: (p) => p.paymentDate ?? "—",
          },
          { key: "paymentReference", label: "Reference", render: (p) => p.paymentReference ?? "—" },
          {
            key: "status",
            label: "Status",
            render: (p) => (
              <Badge variant={STATUS_VARIANT[p.status]}>
                {p.status[0].toUpperCase() + p.status.slice(1)}
              </Badge>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Record commission payout"
        description="Only approved commission records can be paid out."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="po-record" className="text-sm font-medium">Commission record</label>
            <input
              id="po-record"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              placeholder="Commission record ID"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="po-amount" className="text-sm font-medium">Amount</label>
              <input
                id="po-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="8000"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="po-currency" className="text-sm font-medium">Currency</label>
              <select
                id="po-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as any)}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="po-date" className="text-sm font-medium">Payment date</label>
              <input
                id="po-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="po-ref" className="text-sm font-medium">Payment reference</label>
              <input
                id="po-ref"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="PAY-001"
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
              {saving ? "Recording…" : "Record payout"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
