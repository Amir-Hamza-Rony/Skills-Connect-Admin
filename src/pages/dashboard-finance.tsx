import {
  AlarmClock,
  BadgeCheck,
  Banknote,
  CircleAlert,
  Hourglass,
  PiggyBank,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { DashboardSection, type KpiDefinition } from "@/components/dashboard/kpi-card"
import type { DashboardPageSection } from "@/components/dashboard/dashboard-page"
import { financeSummary, listInvoices, listPayments, listQBSync } from "@/lib/fin-store"
import { revenueByMonth } from "@/lib/queues"
import { grossMargin, listOrders } from "@/lib/ops-store"

const aud = (n: number) =>
  n >= 1000
    ? `AUD ${(n / 1000).toLocaleString("en-AU", { maximumFractionDigits: 1 })}k`
    : `AUD ${Math.round(n)}`

const k = (
  label: string,
  caption: string,
  icon: LucideIcon,
  value: string | number,
): KpiDefinition => ({ label, caption, icon, value: String(value) })

/**
 * Finance dashboard (Spec §12): the money view — invoiced, collected,
 * outstanding, overdue, collection rate, margin and QuickBooks sync health.
 */
export function FinanceDashboardPage() {
  const [sections, setSections] = useState<DashboardPageSection[] | null>(null)

  useEffect(() => {
    void (async () => {
      const [summary, invoices, payments, qb, orders, months] = await Promise.all([
        financeSummary(),
        listInvoices(),
        listPayments(),
        listQBSync(),
        listOrders(),
        revenueByMonth().catch(() => ({ months: [] })),
      ])

      const overdueInv = invoices.filter((i) => i.status === "Overdue")
      const syncFails = qb.filter((q) => q.status === "Failed")
      const margin = orders.reduce((sum, o) => sum + grossMargin(o), 0)
      const rate = summary.invoiced > 0 ? Math.round((summary.paid / summary.invoiced) * 100) : 0
      const refunded = payments.filter((p) => p.status === "Refunded").length
      const last = months.months[months.months.length - 1]

      setSections([
        {
          title: "Collections",
          kpis: [
            k("Invoiced", "Total raised", Receipt, aud(summary.invoiced)),
            k("Collected", "Allocated payments", Wallet, aud(summary.paid)),
            k("Outstanding", "Unpaid balances", Hourglass, aud(summary.outstanding)),
            k("Overdue", "Past-due balance", AlarmClock, aud(summary.overdue)),
            k("Collection Rate", "Collected of invoiced", BadgeCheck, `${rate}%`),
          ],
        },
        {
          title: "Profitability & Cash",
          kpis: [
            k("Gross Margin", "Price minus cost", PiggyBank, aud(margin)),
            k("Refunds", "Reversed payments", TrendingDown, refunded),
            k(
              "Latest Month Invoiced",
              last ? last.month : "No data",
              TrendingUp,
              last ? aud(last.invoiced) : "—",
            ),
            k(
              "Latest Month Collected",
              last ? last.month : "No data",
              Banknote,
              last ? aud(last.collected) : "—",
            ),
          ],
        },
        {
          title: "Risk & Follow-up",
          kpis: [
            k("Overdue Invoices", "Finance follow-up", CircleAlert, overdueInv.length),
            k("QuickBooks Sync Errors", "Retries pending", AlarmClock, syncFails.length),
          ],
        },
      ])
    })()
  }, [])

  if (!sections)
    return <p className="text-sm text-muted-foreground">Loading finance metrics…</p>

  return (
    <>
      {sections.map((s) => (
        <DashboardSection key={s.title} title={s.title} kpis={s.kpis} />
      ))}
    </>
  )
}
