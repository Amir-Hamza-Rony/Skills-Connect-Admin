"use client"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import { listAgents } from "@/lib/store"
import type { Agent } from "@/lib/types"

const TIER_BADGE: Record<string, "success" | "info" | "secondary"> = {
  SILVER: "secondary",
  GOLD: "info",
  PLATINUM: "success",
}

export function ExternalAgentsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Agent[] | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    void (async () => setRows(await listAgents()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((a) => {
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [rows, search])

  const isExternalBroker = user?.role === "EXTERNAL_BROKER" || user?.roleNames?.includes("EXTERNAL_BROKER")

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading external agents" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            External Agents
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            External broker partners with fixed wholesale tiers · {visible.length} agents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isExternalBroker ? "success" : "secondary"}>
            {isExternalBroker ? "Your broker tier" : "External broker"}
          </Badge>
        </div>
      </div>

      <div className="relative w-full md:w-64 mb-4">
        <input
          type="search"
          placeholder="Search agent name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <DataTable<Agent>
        rows={visible}
        emptyMessage="No external agents match the current filters."
        columns={[
          { key: "name", label: "Agent Name" },
          { key: "contact", label: "Contact" },
          {
            key: "commissionRule",
            label: "Commission Rule",
            render: (a) => (
              <span className="text-sm text-muted-foreground">
                {a.commissionRule ?? "—"}
              </span>
            ),
          },
          {
            key: "b2bTier",
            label: "Wholesale Tier",
            render: (a) => (
              <Badge variant={TIER_BADGE[a.b2b_tier ?? "SILVER"]}>
                {a.b2b_tier ?? "SILVER"}
              </Badge>
            ),
          },
          {
            key: "active",
            label: "Status",
            render: (a) =>
              a.active ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="outline">Inactive</Badge>
              ),
          },
        ]}
      />

      {isExternalBroker && (
        <div className="mt-8 rounded-xl border bg-card p-6">
          <h3 className="pb-2 text-sm font-semibold">Your Fixed Wholesale Tier</h3>
          <p className="text-sm text-muted-foreground">
            As an external broker, your pricing uses the fixed wholesale tier
            assigned to your account. Margin is calculated against the Approved
            Internal Cost.
          </p>
        </div>
      )}
    </div>
  )
}
