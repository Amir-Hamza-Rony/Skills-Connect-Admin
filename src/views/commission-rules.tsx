"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createCommissionRule,
  deleteCommissionRule,
  listAgents,
  listCommissionRules,
  updateCommissionRule,
} from "@/lib/store"
import type { Agent, AgentCommissionRule, CommissionTier } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<string, "success" | "outline"> = {
  active: "success",
  inactive: "outline",
}
const APPROVAL_VARIANT: Record<string, "secondary" | "success" | "warning"> = {
  draft: "secondary",
  approved: "success",
  rejected: "warning",
}

export function CommissionRulesPage() {
  const [rows, setRows] = useState<AgentCommissionRule[] | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AgentCommissionRule | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "">("")
  const [approvalFilter, setApprovalFilter] = useState<
    "draft" | "approved" | "rejected" | ""
  >("")
  const [agentId, setAgentId] = useState("")
  const [responsibility, setResponsibility] = useState<
    "sales_closing" | "certificate_source" | "rto_contact" | ""
  >("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")
  const [tiers, setTiers] = useState<CommissionTier[]>([
    { minDeals: 1, maxDeals: null, commissionPerDeal: 0 },
  ])
  const [commissionCurrency, setCommissionCurrency] = useState<
    "AUD" | "BDT" | "USD" | "GBP" | "EUR" | "INR"
  >("BDT")
  const [additionalIncentiveAmount, setAdditionalIncentiveAmount] = useState("")
  const [additionalIncentiveCurrency, setAdditionalIncentiveCurrency] = useState<
    "AUD" | "BDT" | "USD" | "GBP" | "EUR" | "INR" | ""
  >("")
  const [status, setStatus] = useState<"active" | "inactive">("active")
  const [approvalStatus, setApprovalStatus] = useState<
    "draft" | "approved" | "rejected"
  >("draft")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  useEffect(() => {
    void (async () => {
      const [r, a] = await Promise.all([listCommissionRules(), listAgents()])
      setRows(r)
      setAgents(a)
    })()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((r) => {
      const a = agentById.get(r.agentId ?? "")
      const label = `${a?.name ?? ""} ${r.responsibility ?? ""}`.toLowerCase()
      if (search && !label.includes(search.toLowerCase())) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (approvalFilter && r.approvalStatus !== approvalFilter) return false
      return true
    })
  }, [rows, search, statusFilter, approvalFilter, agentById])

  const TIER_TOTALS = useMemo(() => {
    return tiers.map((t, i) => ({
      key: i,
      minDeals: t.minDeals,
      maxDeals: t.maxDeals,
      commissionPerDeal: t.commissionPerDeal,
    }))
  }, [tiers])

  function addTier() {
    setTiers([...tiers, { minDeals: 0, maxDeals: null, commissionPerDeal: 0 }])
  }

  function removeTier(i: number) {
    setTiers(tiers.filter((_, idx) => idx !== i))
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!agentId && !responsibility) {
      setError("Provide either an agent or a responsibility.")
      return
    }
    if (agentId && responsibility) {
      setError("Provide either an agent or a responsibility, not both.")
      return
    }
    const validTiers = tiers.every(
      (t) =>
        Number.isFinite(t.minDeals) && t.minDeals >= 0 &&
        (t.maxDeals === null || (Number.isFinite(t.maxDeals) && t.maxDeals >= 0)) &&
        Number.isFinite(t.commissionPerDeal) && t.commissionPerDeal >= 0,
    )
    if (!validTiers) {
      setError("All tiers must have valid non-negative values.")
      return
    }
    setSaving(true)
    try {
      const created = await createCommissionRule({
        agentId: agentId || null,
        responsibility: responsibility || null,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        tiers,
        eligibleOrderStatuses: ["Completed"],
        commissionCurrency,
        additionalIncentiveAmount:
          additionalIncentiveAmount === "" ? null : Number(additionalIncentiveAmount),
        additionalIncentiveCurrency:
          additionalIncentiveCurrency === "" ? null : additionalIncentiveCurrency,
        status,
        approvalStatus,
        approvedBy: null,
        approvedAt: null,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setAgentId("")
      setResponsibility("")
      setEffectiveFrom("")
      setEffectiveTo("")
      setTiers([{ minDeals: 1, maxDeals: null, commissionPerDeal: 0 }])
      setCommissionCurrency("BDT")
      setAdditionalIncentiveAmount("")
      setAdditionalIncentiveCurrency("")
      setStatus("active")
      setApprovalStatus("draft")
    } catch (err: any) {
      setError(err?.message ?? "Failed to create commission rule.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, r: AgentCommissionRule) {
    e.preventDefault()
    setError(null)
    const validTiers = tiers.every(
      (t) =>
        Number.isFinite(t.minDeals) && t.minDeals >= 0 &&
        (t.maxDeals === null || (Number.isFinite(t.maxDeals) && t.maxDeals >= 0)) &&
        Number.isFinite(t.commissionPerDeal) && t.commissionPerDeal >= 0,
    )
    if (!validTiers) {
      setError("All tiers must have valid non-negative values.")
      return
    }
    setSaving(true)
    try {
      const updated = await updateCommissionRule(r.id, {
        tiers,
        commissionCurrency,
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || undefined,
        status,
        approvalStatus,
        additionalIncentiveAmount:
          additionalIncentiveAmount === "" ? null : Number(additionalIncentiveAmount),
        additionalIncentiveCurrency:
          additionalIncentiveCurrency === "" ? null : additionalIncentiveCurrency,
        eligibleOrderStatuses: ["Completed"],
      })
      setRows((prev) =>
        prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update commission rule.")
    } finally {
      setSaving(false)
    }
  }

  async function removeRule(r: AgentCommissionRule) {
    if (!window.confirm(`Delete commission rule for ${agentById.get(r.agentId ?? "")?.name ?? r.responsibility ?? "agent"}?`)) return
    setError(null)
    setSaving(true)
    try {
      await deleteCommissionRule(r.id)
      setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete commission rule.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading commission rules" />
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

  const RESPONSIBILITIES: Array<{ value: string; label: string }> = [
    { value: "sales_closing", label: "Sales / Closing" },
    { value: "certificate_source", label: "Certificate Source" },
    { value: "rto_contact", label: "RTO Contact" },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Agent Commission Rules
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configurable monthly commission tiers · {visible.length} rules
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Live data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add rule
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search agent or responsibility…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "active" | "inactive" | "")}
          className={inputCls}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={approvalFilter}
          onChange={(e) => setApprovalFilter(e.target.value as any)}
          className={inputCls}
        >
          <option value="">All approval</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <DataTable<AgentCommissionRule>
        rows={visible}
        emptyMessage="No commission rules match the current filters."
        rowLabel={(r) => agentById.get(r.agentId ?? "")?.name ?? r.responsibility ?? "agent"}
        columns={[
          {
            key: "agent",
            label: "Agent / Responsibility",
            render: (r) => agentById.get(r.agentId ?? "")?.name ?? r.responsibility ?? "—",
          },
          {
            key: "currency",
            label: "Commission currency",
            render: (r) => r.commissionCurrency,
          },
          {
            key: "tiers",
            label: "Tiers",
            render: (r) =>
              r.tiers
                .map((t) => `${t.minDeals}+ → ${t.commissionPerDeal}`)
                .join(" | "),
          },
          {
            key: "status",
            label: "Status",
            render: (r) => (
              <Badge variant={STATUS_VARIANT[r.status]}>
                {r.status === "active" ? "Active" : "Inactive"}
              </Badge>
            ),
          },
          {
            key: "approval",
            label: "Approval",
            render: (r) => (
              <Badge variant={APPROVAL_VARIANT[r.approvalStatus]}>
                {r.approvalStatus}
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
                    setAgentId(r.agentId ?? "")
                    setResponsibility(r.responsibility ?? "")
                    setEffectiveFrom(r.effectiveFrom)
                    setEffectiveTo(r.effectiveTo ?? "")
                    setTiers(r.tiers)
                    setCommissionCurrency(r.commissionCurrency)
                    setAdditionalIncentiveAmount(
                      String(r.additionalIncentiveAmount ?? ""),
                    )
                    setAdditionalIncentiveCurrency(r.additionalIncentiveCurrency ?? "")
                    setStatus(r.status)
                    setApprovalStatus(r.approvalStatus)
                    setEditing(r)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => removeRule(r)}
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
        title="Add commission rule"
        description="Rules are draft until management approves them. Approved rules are used for calculation."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cr-agent" className="text-sm font-medium">Agent</label>
              <select
                id="cr-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select agent (optional)…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cr-resp" className="text-sm font-medium">Responsibility</label>
              <select
                id="cr-resp"
                value={responsibility}
                onChange={(e) => setResponsibility(e.target.value as any)}
                className={inputCls}
              >
                <option value="">All agents of type (optional)…</option>
                {RESPONSIBILITIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tiers (deals → commission per deal)</label>
            <div className="space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-3 items-end">
                  <div className="relative">
                    <label className="absolute -top-2 left-2 text-[10px] text-muted-foreground bg-background px-1">
                      Min deals
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={t.minDeals}
                      onChange={(e) => {
                        const nt = [...tiers]
                        nt[i] = { ...nt[i], minDeals: Number(e.target.value) || 0 }
                        setTiers(nt)
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div className="relative">
                    <label className="absolute -top-2 left-2 text-[10px] text-muted-foreground bg-background px-1">
                      Max deals (blank = unlimited)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={t.maxDeals ?? ""}
                      onChange={(e) => {
                        const nt = [...tiers]
                        nt[i] = { ...nt[i], maxDeals: e.target.value === "" ? null : Number(e.target.value) }
                        setTiers(nt)
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div className="relative">
                    <label className="absolute -top-2 left-2 text-[10px] text-muted-foreground bg-background px-1">
                      Commission per deal
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={t.commissionPerDeal}
                      onChange={(e) => {
                        const nt = [...tiers]
                        nt[i] = { ...nt[i], commissionPerDeal: Number(e.target.value) || 0 }
                        setTiers(nt)
                      }}
                      className={inputCls}
                    />
                  </div>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={addTier}>
                Add tier
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cr-currency" className="text-sm font-medium">Commission currency</label>
              <select
                id="cr-currency"
                value={commissionCurrency}
                onChange={(e) => setCommissionCurrency(e.target.value as any)}
                className={inputCls}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cr-status" className="text-sm font-medium">Status</label>
              <select
                id="cr-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cr-approval" className="text-sm font-medium">Approval status</label>
              <select
                id="cr-approval"
                value={approvalStatus}
                onChange={(e) => setApprovalStatus(e.target.value as any)}
                className={inputCls}
              >
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cr-from" className="text-sm font-medium">Effective from</label>
              <input
                id="cr-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cr-to" className="text-sm font-medium">Effective to</label>
              <input
                id="cr-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="cr-incentive-amt" className="text-sm font-medium">Additional incentive amount</label>
              <input
                id="cr-incentive-amt"
                type="number"
                min="0"
                step="0.01"
                value={additionalIncentiveAmount}
                onChange={(e) => setAdditionalIncentiveAmount(e.target.value)}
                placeholder="4000"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cr-incentive-cur" className="text-sm font-medium">Incentive currency</label>
              <select
                id="cr-incentive-cur"
                value={additionalIncentiveCurrency}
                onChange={(e) => setAdditionalIncentiveCurrency(e.target.value as any)}
                className={inputCls}
              >
                <option value="">None</option>
                {CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Example tiers (BDT 4,000 / 6,000 / 8,000 per deal) are business material only — not activated as production rules until management approves them.
          </p>
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
              {saving ? "Adding…" : "Add rule"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit commission rule"
        description={editing ? `Approval: ${editing.approvalStatus}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tiers (deals → commission per deal)</label>
            <div className="space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-3 items-end">
                  <div className="relative">
                    <label className="absolute -top-2 left-2 text-[10px] text-muted-foreground bg-background px-1">
                      Min deals
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={t.minDeals}
                      onChange={(e) => {
                        const nt = [...tiers]
                        nt[i] = { ...nt[i], minDeals: Number(e.target.value) || 0 }
                        setTiers(nt)
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div className="relative">
                    <label className="absolute -top-2 left-2 text-[10px] text-muted-foreground bg-background px-1">
                      Max deals (blank = unlimited)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={t.maxDeals ?? ""}
                      onChange={(e) => {
                        const nt = [...tiers]
                        nt[i] = { ...nt[i], maxDeals: e.target.value === "" ? null : Number(e.target.value) }
                        setTiers(nt)
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div className="relative">
                    <label className="absolute -top-2 left-2 text-[10px] text-muted-foreground bg-background px-1">
                      Commission per deal
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={t.commissionPerDeal}
                      onChange={(e) => {
                        const nt = [...tiers]
                        nt[i] = { ...nt[i], commissionPerDeal: Number(e.target.value) || 0 }
                        setTiers(nt)
                      }}
                      className={inputCls}
                    />
                  </div>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={addTier}>
                Add tier
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="er-currency" className="text-sm font-medium">Commission currency</label>
              <select
                id="er-currency"
                value={commissionCurrency}
                onChange={(e) => setCommissionCurrency(e.target.value as any)}
                className={inputCls}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="er-status" className="text-sm font-medium">Status</label>
              <select
                id="er-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="er-approval" className="text-sm font-medium">Approval status</label>
              <select
                id="er-approval"
                value={approvalStatus}
                onChange={(e) => setApprovalStatus(e.target.value as any)}
                className={inputCls}
              >
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="er-from" className="text-sm font-medium">Effective from</label>
              <input
                id="er-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="er-to" className="text-sm font-medium">Effective to</label>
              <input
                id="er-to"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
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
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save rule"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
