"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import { hasPermission } from "@/lib/permissions"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const ISSUE_VARIANT: Record<string, "destructive" | "warning" | "outline" | "secondary"> = {
  amount_mismatch: "destructive",
  currency_mismatch: "destructive",
  status_mismatch: "warning",
  missing_locally: "outline",
  missing_in_qb: "outline",
  duplicate_qb_reference: "destructive",
}

const ISSUE_LABEL: Record<string, string> = {
  amount_mismatch: "Amount mismatch",
  currency_mismatch: "Currency mismatch",
  status_mismatch: "Status mismatch",
  missing_locally: "Missing locally",
  missing_in_qb: "Missing in QuickBooks",
  duplicate_qb_reference: "Duplicate QB reference",
}

const STATUS_VARIANT: Record<string, "success" | "outline" | "secondary"> = {
  open: "outline",
  resolved: "success",
  ignored: "secondary",
}

export function ReconciliationPage() {
  const { permissions } = useAuth()
  const canReconcile = hasPermission(permissions, "finance.reconcile")
  const [rows, setRows] = useState<any[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "ignored" | "all">("open")
  const [entityFilter, setEntityFilter] = useState<"invoice" | "payment" | "customer" | "">("")
  const [resolving, setResolving] = useState<string | null>(null)
const [resolveId, setResolveId] = useState<string | null>(null)
const [resolveStatus, setResolveStatus] = useState<"resolved" | "ignored">("resolved")
const [resolveNote, setResolveNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/reconciliation?status=${statusFilter}&entityType=${entityFilter || ""}`,
      )
      if (!res.ok) {
        setError("Failed to load reconciliation items.")
        return
      }
      const data = await res.json()
      setRows(data.items)
    })()
  }, [statusFilter, entityFilter])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false
      if (entityFilter && r.entityType !== entityFilter) return false
      return true
    })
  }, [rows, statusFilter, entityFilter])

  async function resolveItem(item: any) {
    setResolveId(item.id)
    setResolveStatus("resolved")
    setResolveNote("")
    setError(null)
  }

  async function onResolveSubmit(e: FormEvent) {
    e.preventDefault()
    if (!resolveNote?.trim()) {
      setError("A resolution note is required.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/reconciliation/${resolveId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: resolveStatus, resolutionNote: resolveNote.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.message ?? "Resolve failed.")
        return
      }
      setRows((prev) =>
        prev?.map((r) => (r.id === resolveId ? { ...r, status: resolveStatus } : r)) ?? null,
      )
      setResolveId(null)
      setResolveNote(null)
    } catch {
      setError("Resolve failed.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading reconciliation" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Reconciliation
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Identify and review mismatches between local records and QuickBooks.
            Financial conflicts are not auto-resolved.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Live data</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className={inputCls}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
          <option value="all">All</option>
        </select>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value as any)}
          className={inputCls}
        >
          <option value="">All entities</option>
          <option value="invoice">Invoice</option>
          <option value="payment">Payment</option>
          <option value="customer">Customer</option>
        </select>
      </div>

      {visible.length === 0 && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          No reconciliation items match the current filters.
        </div>
      )}

      <DataTable<any>
        rows={visible}
        emptyMessage="No reconciliation items."
        rowLabel={(r) => `${r.entityType} ${r.entityId}`}
        columns={[
          {
            key: "entity",
            label: "Entity",
            render: (r: any) => `${r.entityType} · ${r.entityId}`,
          },
          {
            key: "issue",
            label: "Issue",
            render: (r: any) => (
              <Badge variant={ISSUE_VARIANT[r.issue] ?? "secondary"}>
                {ISSUE_LABEL[r.issue] ?? r.issue}
              </Badge>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (r: any) => (
              <Badge variant={STATUS_VARIANT[r.status]}>
                {r.status[0].toUpperCase() + r.status.slice(1)}
              </Badge>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (r: any) => (
              <div className="flex items-center gap-2">
                {r.status === "open" && canReconcile ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolveItem(r)}
                    disabled={resolving === r.id}
                  >
                    Resolve
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={resolveId !== null}
        onClose={() => setResolveId(null)}
        title="Resolve reconciliation item"
        description="Record how this mismatch was resolved. Financial conflicts are not auto-resolved."
      >
        <form onSubmit={onResolveSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="resolve-status" className="text-sm font-medium">Resolution</label>
              <select
                id="resolve-status"
                value={resolveStatus}
                onChange={(e) => setResolveStatus(e.target.value as any)}
                className={inputCls}
              >
                <option value="resolved">Resolved</option>
                <option value="ignored">Ignored</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="resolve-note" className="text-sm font-medium">Resolution note</label>
              <textarea
                id="resolve-note"
                value={resolveNote ?? ""}
                onChange={(e) => setResolveNote(e.target.value)}
                rows={3}
                className={inputCls}
                placeholder="Describe how the mismatch was resolved…"
              />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setResolveId(null)}
            >
              Cancel
            </Button>
          <Button type="submit" disabled={saving || !resolveNote?.trim()}>
            {saving ? "Resolving…" : "Resolve"}
          </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
