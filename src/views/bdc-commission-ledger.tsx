"use client"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import { listOrders } from "@/lib/ops-store"
import type { Order } from "@/lib/types"
import { formatMoney } from "@/lib/money-format"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

export function BDCCommissionLedgerPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Order[] | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    void (async () => setRows(await listOrders()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((o) => {
      if (search && !o.id.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [rows, search])

  const totals = useMemo(() => {
    const list = visible
    const totalSelling = list.reduce((s, o) => s + (o.sellingPrice ?? 0), 0)
    const totalInternal = list.reduce((s, o) => s + (o.approvedInternalCost ?? 0), 0)
    const totalCommission = list.reduce((s, o) => s + (o.commissionAmount ?? 0), 0)
    return { totalSelling, totalInternal, totalMargin: totalSelling - totalInternal, totalCommission }
  }, [visible])

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading BDC commission ledger" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const isBDC = user?.role === "SALES_BDC" || user?.roleNames?.includes("SALES_BDC") || user?.role === "BDC" || user?.roleNames?.includes("BDC")

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            BDC Commission Ledger
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Margin vs Approved Internal Cost · {visible.length} orders
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isBDC ? "success" : "secondary"}>
            {isBDC ? "BDC/Sales" : "Ledger"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-6">
        {[
          { label: "Total Selling Price", value: formatMoney(totals.totalSelling, "AUD") },
          { label: "Total Approved Internal Cost", value: formatMoney(totals.totalInternal, "AUD") },
          { label: "Total Margin", value: formatMoney(totals.totalMargin, "AUD") },
          { label: "Total Commission", value: formatMoney(totals.totalCommission, "AUD") },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="relative w-full md:w-64 mb-4">
        <input
          type="search"
          placeholder="Search order ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputCls}
        />
      </div>

      <DataTable<Order>
        rows={visible}
        emptyMessage="No orders match the current filters."
        columns={[
          {
            key: "id",
            label: "Order",
            render: (o) => <span className="font-medium">Order {o.id}</span>,
          },
          {
            key: "clientId",
            label: "Client",
            render: (o) => <span className="text-muted-foreground">{o.clientId}</span>,
          },
          {
            key: "sellingPrice",
            label: "Selling Price (B2C Retail)",
            render: (o) => <span className="tabular-nums">{formatMoney(o.sellingPrice ?? 0, "AUD")}</span>,
          },
          {
            key: "approvedInternalCost",
            label: "Approved Internal Cost",
            render: (o) => <span className="tabular-nums">{formatMoney(o.approvedInternalCost ?? 0, "AUD")}</span>,
          },
          {
            key: "margin",
            label: "Margin",
            render: (o) => {
              const margin = (o.sellingPrice ?? 0) - (o.approvedInternalCost ?? 0)
              return (
                <span className={`tabular-nums ${margin >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatMoney(margin, "AUD")}
                </span>
              )
            },
          },
          {
            key: "commissionAmount",
            label: "Commission",
            render: (o) => (
              <span className="tabular-nums">{formatMoney(o.commissionAmount ?? 0, "AUD")}</span>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (o) => (
              <Badge variant={o.status === "DELIVERED" ? "success" : "secondary"}>
                {o.status}
              </Badge>
            ),
          },
        ]}
      />

      <Dialog
        open={false}
        onClose={() => {}}
        title="Export Ledger"
        description="Download the BDC commission ledger as CSV."
      >
        <Button size="sm" variant="outline">
          Download CSV
        </Button>
      </Dialog>
    </div>
  )
}
