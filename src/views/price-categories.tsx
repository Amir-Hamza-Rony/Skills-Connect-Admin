"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createPriceCategory,
  deletePriceCategory,
  listPriceCategories,
  updatePriceCategory,
} from "@/lib/store"
import type { PriceCategory } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<string, "success" | "outline"> = {
  active: "success",
  inactive: "outline",
}

export function PriceCategoriesPage() {
  const [rows, setRows] = useState<PriceCategory[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PriceCategory | null>(null)
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "">("")
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"active" | "inactive">("active")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listPriceCategories()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter(
      (c) => !statusFilter || c.status === statusFilter,
    )
  }, [rows, statusFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!code.trim() || !name.trim()) {
      setError("Code and name are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createPriceCategory({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        status,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setCode("")
      setName("")
      setDescription("")
      setStatus("active")
    } catch (err: any) {
      setError(
        err?.message ?? "Failed to create price category. The code may already exist.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, c: PriceCategory) {
    e.preventDefault()
    setError(null)
    if (!code.trim() || !name.trim()) {
      setError("Code and name are required.")
      return
    }
    setSaving(true)
    try {
      const updated = await updatePriceCategory(c.id, {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        status,
      })
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(
        err?.message ?? "Failed to update price category. The code may already exist.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(c: PriceCategory) {
    setError(null)
    setSaving(true)
    try {
      const updated = await updatePriceCategory(c.id, {
        status: c.status === "active" ? "inactive" : "active",
      })
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
    } catch (err: any) {
      setError(err?.message ?? "Failed to update price category status.")
    } finally {
      setSaving(false)
    }
  }

  async function removeCategory(c: PriceCategory) {
    if (!window.confirm(`Delete price category ${c.code}?`)) return
    setError(null)
    setSaving(true)
    try {
      await deletePriceCategory(c.id)
      setRows((prev) => prev?.filter((r) => r.id !== c.id) ?? null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete price category.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading price categories" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Price Categories
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Client selling price categories · {visible.length} categories
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add category
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "active" | "inactive" | "")
          }
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable<PriceCategory>
        rows={visible}
        emptyMessage="No price categories match the current filters."
        rowLabel={(c) => c.code}
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "description", label: "Description", render: (c) => c.description ?? "—" },
          {
            key: "status",
            label: "Status",
            render: (c) => (
              <Badge variant={STATUS_VARIANT[c.status]}>
                {c.status === "active" ? "Active" : "Inactive"}
              </Badge>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (c) => (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCode(c.code)
                    setName(c.name)
                    setDescription(c.description ?? "")
                    setStatus(c.status)
                    setEditing(c)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant={c.status === "active" ? "destructive" : "default"}
                  onClick={() => toggleStatus(c)}
                >
                  {c.status === "active" ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => removeCategory(c)}
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
        title="Add price category"
        description="Used to classify client selling prices in the price list."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pc-code" className="text-sm font-medium">Code</label>
              <input
                id="pc-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="FLOOR"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pc-status" className="text-sm font-medium">Status</label>
              <select
                id="pc-status"
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
            <label htmlFor="pc-name" className="text-sm font-medium">Name</label>
            <input
              id="pc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Floor Price"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pc-desc" className="text-sm font-medium">Description</label>
            <input
              id="pc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Minimum sellable price"
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
              {saving ? "Adding…" : "Add category"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit price category"
        description={editing ? `Code: ${editing.code}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ec-code" className="text-sm font-medium">Code</label>
              <input
                id="ec-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="FLOOR"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ec-status" className="text-sm font-medium">Status</label>
              <select
                id="ec-status"
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
            <label htmlFor="ec-name" className="text-sm font-medium">Name</label>
            <input
              id="ec-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Floor Price"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ec-desc" className="text-sm font-medium">Description</label>
            <input
              id="ec-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Minimum sellable price"
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
              {saving ? "Saving…" : "Save category"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
