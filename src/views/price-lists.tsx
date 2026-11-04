"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createPriceList,
  deletePriceList,
  listPriceCategories,
  listPriceLists,
  listQualifications,
  priceListLabel,
  qualificationLabel,
  updatePriceList,
} from "@/lib/store"
import type { PriceCategory, PriceList, Qualification } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<string, "success" | "warning" | "outline"> = {
  active: "success",
  draft: "warning",
  inactive: "outline",
}

export function PriceListsPage() {
  const [rows, setRows] = useState<PriceList[] | null>(null)
  const [quals, setQuals] = useState<Qualification[]>([])
  const [cats, setCats] = useState<PriceCategory[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PriceList | null>(null)
  const [search, setSearch] = useState("")
  const [qualFilter, setQualFilter] = useState("")
  const [catFilter, setCatFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<
    "active" | "inactive" | "draft" | ""
  >("")
  const [qualificationId, setQualificationId] = useState("")
  const [priceCategoryId, setPriceCategoryId] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState<"AUD" | "BDT" | "USD" | "GBP" | "EUR" | "INR">("AUD")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")
  const [status, setStatus] = useState<"active" | "inactive" | "draft">("active")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals])
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats])

  useEffect(() => {
    void (async () => {
      const [r, q, c] = await Promise.all([
        listPriceLists(),
        listQualifications(),
        listPriceCategories(),
      ])
      setRows(r)
      setQuals(q)
      setCats(c)
    })()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((p) => {
      const q = qualById.get(p.qualificationId)
      const c = catById.get(p.priceCategoryId)
      const label = `${(q?.code ?? "")} ${(q?.title ?? "")} ${(c?.code ?? "")} ${(c?.name ?? "")}`.toLowerCase()
      if (search && !label.includes(search.toLowerCase())) return false
      if (qualFilter && p.qualificationId !== qualFilter) return false
      if (catFilter && p.priceCategoryId !== catFilter) return false
      if (statusFilter && p.status !== statusFilter) return false
      return true
    })
  }, [rows, search, qualFilter, catFilter, statusFilter, qualById, catById])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!qualificationId || !priceCategoryId || !amount || !effectiveFrom) {
      setError("Qualification, price category, amount, and effective date are required.")
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) {
      setError("Amount must be a non-negative number.")
      return
    }
    setSaving(true)
    try {
      const created = await createPriceList({
        qualificationId,
        priceCategoryId,
        amount: amt,
        currency,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        status,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setQualificationId("")
      setPriceCategoryId("")
      setAmount("")
      setCurrency("AUD")
      setEffectiveFrom("")
      setEffectiveTo("")
      setStatus("active")
    } catch (err: any) {
      setError(
        err?.message ??
          "Failed to create price list. An overlapping active period may already exist.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, p: PriceList) {
    e.preventDefault()
    setError(null)
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) {
      setError("Amount must be a non-negative number.")
      return
    }
    setSaving(true)
    try {
      const updated = await updatePriceList(p.id, {
        amount: amt,
        currency,
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || undefined,
        status,
      })
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update price list.")
    } finally {
      setSaving(false)
    }
  }

  async function removeList(p: PriceList) {
    if (!window.confirm(`Delete price list ${priceListLabel(p)}?`)) return
    setError(null)
    setSaving(true)
    try {
      await deletePriceList(p.id)
      setRows((prev) => prev?.filter((r) => r.id !== p.id) ?? null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete price list.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading price lists" />
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
            Qualification Price Lists
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Client selling prices per qualification and category · {visible.length} lists
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add price list
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search qualification or category…"
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
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className={inputCls}
        >
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              `${c.code} — ${c.name}`
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "active" | "inactive" | "draft" | "")
          }
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable<PriceList>
        rows={visible}
        emptyMessage="No price lists match the current filters."
        rowLabel={priceListLabel}
        columns={[
          {
            key: "qualification",
            label: "Qualification",
            render: (p) =>
              qualificationLabel(qualById.get(p.qualificationId) ?? ({} as Qualification)),
          },
          {
            key: "category",
            label: "Price category",
            render: (p) => {
              const c = catById.get(p.priceCategoryId)
              return c ? `${c.code} — ${c.name}` : "—"
            },
          },
          { key: "amount", label: "Amount", render: (p) => `${p.amount} ${p.currency}` },
          {
            key: "status",
            label: "Status",
            render: (p) => (
              <Badge variant={STATUS_VARIANT[p.status]}>
                {p.status[0].toUpperCase() + p.status.slice(1)}
              </Badge>
            ),
          },
          {
            key: "effective",
            label: "Effective",
            render: (p) => `${p.effectiveFrom} → ${p.effectiveTo ?? "present"}`,
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
                    setQualificationId(p.qualificationId)
                    setPriceCategoryId(p.priceCategoryId)
                    setAmount(String(p.amount))
                    setCurrency(p.currency)
                    setEffectiveFrom(p.effectiveFrom)
                    setEffectiveTo(p.effectiveTo ?? "")
                    setStatus(p.status)
                    setEditing(p)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => removeList(p)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add price list"
        description="Client selling price — separate from supplier cost in supplier routes."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pl-qual" className="text-sm font-medium">Qualification</label>
              <select
                id="pl-qual"
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
              <label htmlFor="pl-cat" className="text-sm font-medium">Price category</label>
              <select
                id="pl-cat"
                value={priceCategoryId}
                onChange={(e) => setPriceCategoryId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select category…</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pl-amount" className="text-sm font-medium">Amount</label>
              <input
                id="pl-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5500"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pl-currency" className="text-sm font-medium">Currency</label>
              <select
                id="pl-currency"
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
              <label htmlFor="pl-from" className="text-sm font-medium">Effective from</label>
              <input
                id="pl-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pl-to" className="text-sm font-medium">Effective to</label>
              <input
                id="pl-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pl-status" className="text-sm font-medium">Status</label>
              <select
                id="pl-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="inactive">Inactive</option>
              </select>
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
              {saving ? "Adding…" : "Add price list"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit price list"
        description={editing ? priceListLabel(editing) : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="el-amount" className="text-sm font-medium">Amount</label>
              <input
                id="el-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5500"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="el-currency" className="text-sm font-medium">Currency</label>
              <select
                id="el-currency"
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
              <label htmlFor="el-from" className="text-sm font-medium">Effective from</label>
              <input
                id="el-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="el-to" className="text-sm font-medium">Effective to</label>
              <input
                id="el-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="el-status" className="text-sm font-medium">Status</label>
              <select
                id="el-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="inactive">Inactive</option>
              </select>
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
              {saving ? "Saving…" : "Save price list"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
