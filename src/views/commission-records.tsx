"use client"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  agentLabel,
  approveCommissionRecord,
  calculateCommission,
  listAgents,
  listCommissionRecords,
} from "@/lib/store"
import type { Agent, CommissionRecord } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  calculated: "warning",
  approved: "success",
  rejected: "destructive",
  paid: "outline",
}

export function CommissionRecordsPage() {
  const [rows, setRows] = useState<CommissionRecord[] | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState("")
  const [periodMonth, setPeriodMonth] = useState("")
  const [periodYear, setPeriodYear] = useState("")
  const [statusFilter, setStatusFilter] = useState<
    "draft" | "calculated" | "approved" | "rejected" | "paid" | ""
  >("")
  const [calculating, setCalculating] = useState(false)
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [calculateOpen, setCalculateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  useEffect(() => {
    void (async () => {
      const [r, a] = await Promise.all([listCommissionRecords(), listAgents()])
      setRows(r)
      setAgents(a)
    })()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((r) => {
      const a = agentById.get(r.agentId)
      const label = `${a?.name ?? ""}`.toLowerCase()
      if (search && !label.includes(search.toLowerCase())) return false
      if (statusFilter && r.status !== statusFilter) return false
      return true
    })
  }, [rows, search, statusFilter, agentById])

  const handleCalculate = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!agentId || !periodMonth || !periodYear) {
      setError("Agent, period month, and period year are required.")
      return
    }
    const m = Number(periodMonth)
    const y = Number(periodYear)
    if (!Number.isFinite(m) || m < 1 || m > 12) {
      setError("Period month must be 1-12.")
      return
    }
    if (!Number.isFinite(y) || y < 2000) {
      setError("Period year is invalid.")
      return
    }
    setCalculating(true)
    try {
      const record = await calculateCommission({ agentId: agentId, periodMonth: m, periodYear: y })
      setRows((prev) => (prev ? [record, ...prev] : [record]))
      setAgentId("")
      setPeriodMonth("")
      setPeriodYear("")
    } catch (err: any) {
      setError(err?.message ?? "Commission calculation failed.")
    } finally {
      setCalculating(false)
    }
  }, [agentId, periodMonth, periodYear])

  async function approve(record: CommissionRecord) {
    setError(null)
    setSaving(true)
    try {
      const updated = await approveCommissionRecord(record.id)
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
    } catch (err: any) {
      setError(err?.message ?? "Failed to approve commission record.")
    } finally {
      setSaving(false)
    }
  }

  async function reject(record: CommissionRecord) {
    const reason = window.prompt("Rejection reason (required):")
    if (reason === null || !reason.trim()) {
      setError("Rejection reason is required.")
      return
    }
    setError(null)
    setSaving(true)
    try {
      // Reject via API is not exposed as a store function yet; use fetch directly.
      const res = await fetch(`/api/commission-records/${record.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionReason: reason.trim() }),
      })
      if (!res.ok) throw new Error("Reject failed")
      const data = await res.json()
      setRows((prev) =>
        prev?.map((r) => (r.id === data.commissionRecord.id ? data.commissionRecord : r)) ?? null,
      )
    } catch (err: any) {
      setError(err?.message ?? "Failed to reject commission record.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading commission records" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Monthly Commission Records
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Calculated per agent per month · {visible.length} records
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCalculateOpen(true)}>
            Calculate
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search agent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="calculated">Calculated</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      <DataTable<CommissionRecord>
        rows={visible}
        emptyMessage="No commission records match the current filters."
        rowLabel={(r) => agentById.get(r.agentId)?.name ?? r.agentId}
        columns={[
          {
            key: "agent",
            label: "Agent",
            render: (r) => agentById.get(r.agentId)?.name ?? "—",
          },
          {
            key: "period",
            label: "Period",
            render: (r) => `${r.periodMonth}/${r.periodYear}`,
          },
          {
            key: "eligible",
            label: "Eligible deals",
            render: (r) => r.eligibleDealCount,
          },
          {
            key: "amount",
            label: "Commission amount",
            render: (r) => `${r.commissionAmount} ${r.commissionCurrency}`,
          },
          {
            key: "status",
            label: "Status",
            render: (r) => (
              <Badge variant={STATUS_VARIANT[r.status]}>
                {r.status[0].toUpperCase() + r.status.slice(1)}
              </Badge>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (r) => (
              <div className="flex items-center gap-2">
                {r.status === "calculated" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => approve(r)}
                      disabled={saving}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reject(r)}
                      disabled={saving}
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={calculateOpen}
        onClose={() => setCalculateOpen(false)}
        title="Calculate commission"
        description="Calculates commission for an agent and period using approved rules."
      >
        <form onSubmit={handleCalculate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="calc-agent" className="text-sm font-medium">Agent</label>
              <select
                id="calc-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {agentLabel(a)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="calc-month" className="text-sm font-medium">Period month</label>
              <input
                id="calc-month"
                type="number"
                min="1"
                max="12"
                value={periodMonth}
                onChange={(e) => setPeriodMonth(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="calc-year" className="text-sm font-medium">Period year</label>
              <input
                id="calc-year"
                type="number"
                min="2000"
                value={periodYear}
                onChange={(e) => setPeriodYear(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Records are created in "calculated" status and must be approved by management before payout.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={calculating}>
              {calculating ? "Calculating…" : "Calculate commission"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
