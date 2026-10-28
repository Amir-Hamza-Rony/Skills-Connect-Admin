"use client"
import {
  Building2,
  FileCheck2,
  Gauge,
  Send,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { DashboardSection, type KpiDefinition } from "@/components/dashboard/kpi-card"
import type { DashboardPageSection } from "@/components/dashboard/dashboard-page"
import { revenueBySupplier } from "@/lib/queues"
import { listOrders } from "@/lib/ops-store"
import { api } from "@/lib/api"

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

interface TurnaroundReport {
  totalCompleted: number
  averageDays: number
}

/**
 * RTO / Sourcing dashboard (Spec §12): submission readiness, assessment
 * progress, turnaround time and supplier/RTO revenue split.
 */
export function RtoDashboardPage() {
  const [sections, setSections] = useState<DashboardPageSection[] | null>(null)

  useEffect(() => {
    void (async () => {
      const [orders, turnaround, supplier] = await Promise.all([
        listOrders(),
        api
          .get<TurnaroundReport>("/reports/rto-turnaround")
          .catch(() => ({ totalCompleted: 0, averageDays: 0 })),
        revenueBySupplier().catch(() => ({ bySourceAgent: [], byRto: [] })),
      ])

      const inStatus = (s: string[]) => orders.filter((o) => s.includes(o.status)).length
      const withRto = supplier.byRto.length
      const topRto = supplier.byRto[0]

      setSections([
        {
          title: "Submission Readiness",
          kpis: [
            k("Ready for Submission", "Pack complete", Send, inStatus(["Ready for Submission"])),
            k("Submitted", "With source agent + RTO", Truck, inStatus(["Submitted to Source Agent", "Submitted to RTO", "RTO Acknowledged"])),
            k("Under Assessment", "With provider", FileCheck2, inStatus(["Under Assessment", "Additional Evidence Required"])),
          ],
        },
        {
          title: "Turnaround & Completion",
          kpis: [
            k("Certificates Issued", "Approved + delivered", Building2, inStatus(["Certificate Issued", "Completed"])),
            k("Completed Orders", "Turnaround sample", Gauge, turnaround.totalCompleted),
            k("Avg Turnaround", "Days to complete", Gauge, `${turnaround.averageDays}d`),
          ],
        },
        {
          title: "Sourcing & Suppliers",
          kpis: [
            k("Active RTOs", "In revenue split", Users, withRto),
            k(
              "Top RTO Revenue",
              topRto ? topRto.name : "No data",
              Building2,
              topRto ? aud(topRto.revenue) : "—",
            ),
          ],
        },
      ])
    })()
  }, [])

  if (!sections)
    return <p className="text-sm text-muted-foreground">Loading sourcing metrics…</p>

  return (
    <>
      {sections.map((s) => (
        <DashboardSection key={s.title} title={s.title} kpis={s.kpis} />
      ))}
    </>
  )
}
