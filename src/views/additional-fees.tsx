"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createAdditionalFee,
  listAdditionalFees,
  listPriceCategories,
  listQualifications,
  qualificationLabel,
} from "@/lib/store"
import type { AdditionalFee, PriceCategory, Qualification } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<string, "success" | "outline"> = {
  active: "success",
  inactive: "outline",
}

export function AdditionalFeesPage() {
  const [rows, setRows] = useState<AdditionalFee[] | null>(null)
  const [quals, setQuals] = useState<Qualification[]>([])
  const [cats, setCats] = useState<PriceCategory[]>([])
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const [applicabilityFilter, setApplicabilityFilter] = useState<
    "qualification" | "priceCategory" | ""
  >("")
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "">("")
  const [applicability, setApplicability] = useState<
    "qualification" | "priceCategory"
  >("qualification")
  const [referenceId, setReferenceId] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState<"AUD" | "BDT" | "USD" | "GBP" | "EUR" | "INR">("AUD")
  const [description, setDescription] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")
  const [isOptional, setIsOptional] = useState(true)
  const [status, setStatus] = useState<"active" | "inactive">("active")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals])
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats])

  useEffect(() => {
    void (async () => {
      const [f, q, c] = await Promise.all([
        listAdditionalFees(),
        listQualifications(),
        listPriceCategories(),
      ])
      setRows(f)
      setQuals(q)
      setCats(c)
    })()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((f) => {
      if (applicabilityFilter && f.applicability !== applicabilityFilter) return false
      if (statusFilter && f.status !== statusFilter) return false
      return true
    })
  }, [rows, applicabilityFilter, statusFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!referenceId || !amount || !effectiveFrom) {
      setError("Reference, amount, and effective date are required.")
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) {
      setError("Amount must be a non-negative number.")
      return
    }
    setSaving(true)
    try {
      const created = await createAdditionalFee({
        applicability,
        referenceId,
        amount: amt,
        currency,
        description: description.trim() || null,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        isOptional,
        status,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setReferenceId("")
      setAmount("")
      setCurrency("AUD")
      setDescription("")
      setEffectiveFrom("")
      setEffectiveTo("")
      setIsOptional(true)
      setStatus("active")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create additional fee.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading additional fees" />
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
            Additional Fees
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configurable charges applied on top of client selling price · {visible.length} fees
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add fee
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select
          value={applicabilityFilter}
          onChange={(e) =>
            setApplicabilityFilter(e.target.value as "qualification" | "priceCategory" | "")
          }
          className={inputCls}
        >
          <option value="">All applicability</option>
          <option value="qualification">Qualification</option>
          <option value="priceCategory">Price category</option>
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

      <DataTable<AdditionalFee>
        rows={visible}
        emptyMessage="No additional fees match the current filters."
        rowLabel={(f) => `${f.applicability}: ${f.referenceId}`}
        columns={[
          {
            key: "applicability",
            label: "Applicability",
            render: (f) => f.applicability === "qualification" ? "Qualification" : "Price category",
          },
          { key: "amount", label: "Amount", render: (f) => `${f.amount} ${f.currency}` },
          { key: "description", label: "Description", render: (f) => f.description ?? "—" },
          {
            key: "optional",
            label: "Optional",
            render: (f) => (f.isOptional ? "Yes" : "No"),
          },
          {
            key: "status",
            label: "Status",
            render: (f) => (
              <Badge variant={STATUS_VARIANT[f.status]}>
                {f.status === "active" ? "Active" : "Inactive"}
              </Badge>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add additional fee"
        description="Optional fees are not automatically applied to every order."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="af-applicability" className="text-sm font-medium">Applies to</label>
              <select
                id="af-applicability"
                value={applicability}
                onChange={(e) => setApplicability(e.target.value as any)}
                className={inputCls}
              >
                <option value="qualification">Qualification</option>
                <option value="priceCategory">Price category</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="af-status" className="text-sm font-medium">Status</label>
              <select
                id="af-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="af-reference" className="text-sm font-medium">Reference</label>
            <select
              id="af-reference"
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              className={inputCls}
            >
              <option value="">Select…</option>
              {applicability === "qualification"
                ? quals.map((q) => (
                    <option key={q.id} value={q.id}>
                      {qualificationLabel(q)}
                    </option>
                  ))
                : cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="af-amount" className="text-sm font-medium">Amount</label>
              <input
                id="af-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="af-currency" className="text-sm font-medium">Currency</label>
              <select
                id="af-currency"
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
              <label htmlFor="af-from" className="text-sm font-medium">Effective from</label>
              <input
                id="af-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="af-to" className="text-sm font-medium">Effective to</label>
              <input
                id="af-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="af-optional" className="text-sm font-medium">Optional</label>
              <select
                id="af-optional"
                value={String(isOptional)}
                onChange={(e) => setIsOptional(e.target.value === "true")}
                className={inputCls}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="af-desc" className="text-sm font-medium">Description</label>
            <input
              id="af-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Work placement fee"
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
              {saving ? "Adding…" : "Add fee"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
