"use client"
import {
  Award,
  BadgeCheck,
  Briefcase,
  CircleAlert,
  Handshake,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { DashboardSection, type KpiDefinition } from "@/components/dashboard/kpi-card"
import type { DashboardPageSection } from "@/components/dashboard/dashboard-page"
import { listClients, listOrders } from "@/lib/ops-store"

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
 * Sales / Closing Agent dashboard (Spec §12): pipeline, won deals, sales
 * value, conversion and certificates delivered.
 */
export function AgentDashboardPage() {
  const [sections, setSections] = useState<DashboardPageSection[] | null>(null)

  useEffect(() => {
    void (async () => {
      const [orders, clients] = await Promise.all([listOrders(), listClients()])

      const inStatus = (s: string[]) => orders.filter((o) => s.includes(o.status)).length
      const sales = orders.reduce((sum, o) => sum + o.sellingPrice, 0)
      const pipeline = orders.filter((o) =>
        ["Lead", "Qualified", "Won"].includes(o.status),
      )
      const pipelineValue = pipeline.reduce((sum, o) => sum + o.sellingPrice, 0)
      const won = inStatus(["Won"])
      const lost = inStatus(["Lost"])
      const decided = won + lost
      const conversion = decided > 0 ? Math.round((won / decided) * 100) : 0
      const certificates = inStatus(["Certificate Issued", "Completed"])
      const activeClients = clients.filter((c) => c.status === "Active").length

      setSections([
        {
          title: "Pipeline",
          kpis: [
            k("Open Pipeline", "Lead → Won", Handshake, pipeline.length),
            k("Pipeline Value", "Selling price of open deals", TrendingUp, aud(pipelineValue)),
            k("Total Booked", "All order value", Wallet, aud(sales)),
          ],
        },
        {
          title: "Conversion & Delivery",
          kpis: [
            k("Won", "Closed won", BadgeCheck, won),
            k("Conversion Rate", "Won of decided", TrendingUp, `${conversion}%`),
            k("Lost", "Closed lost", CircleAlert, lost),
            k("Certificates Issued", "Delivered to clients", Award, certificates),
          ],
        },
        {
          title: "Clients",
          kpis: [
            k("Active Clients", "Currently engaged", Users, activeClients),
            k("Total Clients", "All records", Briefcase, clients.length),
          ],
        },
      ])
    })()
  }, [])

  if (!sections)
    return <p className="text-sm text-muted-foreground">Loading agent metrics…</p>

  return (
    <>
      {sections.map((s) => (
        <DashboardSection key={s.title} title={s.title} kpis={s.kpis} />
      ))}
    </>
  )
}
