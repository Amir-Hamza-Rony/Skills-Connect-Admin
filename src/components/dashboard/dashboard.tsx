import {
  AlarmClock,
  BadgeCheck,
  CircleAlert,
  FileCheck2,
  FileClock,
  FileX2,
  Hourglass,
  Inbox,
  PiggyBank,
  Send,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { DashboardSection, type KpiDefinition } from "@/components/dashboard/kpi-card"
import { financeSummary, listInvoices, listQBSync } from "@/lib/fin-store"
import { grossMargin, listClients, listDocuments, listOrders } from "@/lib/ops-store"
import type { OrderDocument } from "@/lib/types"

const aud = (n: number) =>
  n >= 1000
    ? `AUD ${(n / 1000).toLocaleString("en-AU", { maximumFractionDigits: 1 })}k`
    : `AUD ${n}`

interface SectionDef {
  title: string
  kpis: KpiDefinition[]
}

/**
 * Management dashboard (Spec §12) with LIVE values from the ops + finance
 * stores. Renders bare KPI sections; the unified Dashboard shell owns the
 * page header and the view switcher.
 */
export function ManagementDashboard() {
  const [sections, setSections] = useState<SectionDef[] | null>(null)

  useEffect(() => {
    void (async () => {
      const [clients, orders, summary, invoices, qb] = await Promise.all([
        listClients(),
        listOrders(),
        financeSummary(),
        listInvoices(),
        listQBSync(),
      ])
      const docs: OrderDocument[] = (
        await Promise.all(orders.map((o) => listDocuments(o.id)))
      ).flat()

      const inQueue = (s: string[]) => docs.filter((d) => s.includes(d.status)).length
      const inStatus = (s: string[]) => orders.filter((o) => s.includes(o.status)).length
      const sales = orders.reduce((sum, o) => sum + o.sellingPrice, 0)
      const margin = orders.reduce((sum, o) => sum + grossMargin(o), 0)
      const rate = summary.invoiced > 0 ? Math.round((summary.paid / summary.invoiced) * 100) : 0
      const overdueInv = invoices.filter((i) => i.status === "Overdue").length
      const syncFails = qb.filter((q) => q.status === "Failed").length
      const certPending = orders.filter((o) => o.certificateStatus !== "Delivered to Client").length

      const k = (
        label: string,
        caption: string,
        icon: LucideIcon,
        value: string | number,
      ): KpiDefinition => ({
        label,
        caption,
        icon,
        value: String(value),
      })

      setSections([
        {
          title: "Sales & Collection",
          kpis: [
            k("Total Sales", `${orders.length} active orders`, TrendingUp, aud(sales)),
            k("Collected", "Allocated payments", Wallet, aud(summary.paid)),
            k("Outstanding", "Unpaid balances", Hourglass, aud(summary.outstanding)),
            k("Overdue", "Past-due instalments", AlarmClock, aud(summary.overdue)),
            k("Gross Margin", "Price minus cost", PiggyBank, aud(margin)),
            k("Collection Rate", "Collected of invoiced", BadgeCheck, `${rate}%`),
          ],
        },
        {
          title: "Documents & Evidence",
          kpis: [
            k("Waiting for Client", "Requested, not received", Inbox, inQueue(["Requested", "Not Received"])),
            k("Under Review", "Received + under review", FileClock, inQueue(["Received", "Under Review"])),
            k("Rejected", "Needs resubmission", FileX2, inQueue(["Rejected"])),
          ],
        },
        {
          title: "RTO · Workflow · Certificates",
          kpis: [
            k("Ready for RTO", "Awaiting submission", Send, inStatus(["Ready for Submission"])),
            k("Under Assessment", "With provider / RTO", FileCheck2, inStatus(["Under Assessment", "Submitted to RTO", "RTO Acknowledged"])),
            k("Certificates Pending", "Not yet delivered", CircleAlert, certPending),
          ],
        },
        {
          title: "Risk & Attention",
          kpis: [
            k("Active Clients", "Client records", Users, clients.length),
            k("Orders On Hold", "Exception queue", CircleAlert, inStatus(["On Hold"])),
            k("Overdue Invoices", "Finance follow-up", TrendingDown, overdueInv),
            k("Sync Errors", "QuickBooks retries", AlarmClock, syncFails),
          ],
        },
      ])
    })()
  }, [])

  if (!sections)
    return <p className="text-sm text-muted-foreground">Loading metrics…</p>

  return (
    <>
      {sections.map((section) => (
        <DashboardSection
          key={section.title}
          title={section.title}
          kpis={section.kpis}
        />
      ))}
    </>
  )
}
