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
  Wallet,
  type LucideIcon,
} from "lucide-react"

import { DashboardSection } from "@/components/dashboard/kpi-card"
import { Badge } from "@/components/ui/badge"
import { useTheme } from "@/lib/theme"

interface SectionDef {
  title: string
  kpis: Array<{ label: string; caption: string; icon: LucideIcon }>
}

/**
 * Management dashboard skeleton (Spec §12) in the premium dark-teal
 * reference style. Values stay skeleton until Day 2–4 wire real data —
 * no fake metrics are shown.
 */
const SECTIONS: SectionDef[] = [
  {
    title: "Sales & Collection",
    kpis: [
      { label: "Total Sales", icon: TrendingUp, caption: "All active orders" },
      { label: "Collected", icon: Wallet, caption: "Allocated payments" },
      { label: "Outstanding", icon: Hourglass, caption: "Unpaid balances" },
      { label: "Overdue", icon: AlarmClock, caption: "Past-due instalments" },
      { label: "Gross Margin", icon: PiggyBank, caption: "Price minus cost" },
      { label: "Collection Rate", icon: BadgeCheck, caption: "Collected of invoiced" },
    ],
  },
  {
    title: "Documents & Evidence",
    kpis: [
      { label: "Waiting for Client", icon: Inbox, caption: "Requested, not received" },
      { label: "Under Review", icon: FileClock, caption: "With document reviewers" },
      { label: "Rejected", icon: FileX2, caption: "Needs resubmission" },
    ],
  },
  {
    title: "RTO · Workflow · Certificates",
    kpis: [
      { label: "Ready for RTO", icon: Send, caption: "Awaiting submission" },
      { label: "Under Assessment", icon: FileCheck2, caption: "With provider / RTO" },
      { label: "Certificates Pending", icon: CircleAlert, caption: "Issued, not delivered" },
    ],
  },
  {
    title: "Risk & Attention",
    kpis: [
      { label: "Orders On Hold", icon: CircleAlert, caption: "Exception queue" },
      { label: "Overdue Invoices", icon: TrendingDown, caption: "Finance follow-up" },
      { label: "Sync Errors", icon: AlarmClock, caption: "QuickBooks retries" },
    ],
  },
]

export function Dashboard() {
  const { theme, resolvedTheme } = useTheme()

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Business overview — viewing as{" "}
            <span className="font-medium text-foreground">Administrator</span>
            {" · "}theme {theme} ({resolvedTheme})
          </p>
        </div>
        <Badge variant="info">Preview shell</Badge>
      </div>

      {SECTIONS.map((section) => (
        <DashboardSection
          key={section.title}
          title={section.title}
          kpis={section.kpis}
        />
      ))}

      <p className="pb-2 text-center text-xs text-muted-foreground">
        Live metrics connect on Day 2–4 as Clients, Orders, Documents, Finance
        and QuickBooks modules land.
      </p>
    </div>
  )
}
