"use client"
import {
  AlarmClock,
  CircleAlert,
  FileClock,
  FileX2,
  Inbox,
  ListChecks,
  Send,
  FileCheck2,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { DashboardSection, type KpiDefinition } from "@/components/dashboard/kpi-card"
import type { DashboardPageSection } from "@/components/dashboard/dashboard-page"
import { listDocuments, listOrders, listTasks } from "@/lib/ops-store"
import type { OrderDocument } from "@/lib/types"

const k = (
  label: string,
  caption: string,
  icon: LucideIcon,
  value: string | number,
): KpiDefinition => ({ label, caption, icon, value: String(value) })

/**
 * Operations dashboard (Spec §12): the queue view — document bottlenecks,
 * workflow by stage, submission readiness and overdue tasks.
 */
export function OperationsDashboardPage() {
  const [sections, setSections] = useState<DashboardPageSection[] | null>(null)

  useEffect(() => {
    void (async () => {
      const [orders, tasks] = await Promise.all([listOrders(), listTasks()])
      const docs: OrderDocument[] = (
        await Promise.all(orders.map((o) => listDocuments(o.id)))
      ).flat()

      const inQueue = (s: string[]) => docs.filter((d) => s.includes(d.status)).length
      const inStatus = (s: string[]) => orders.filter((o) => s.includes(o.status)).length
      const now = new Date()
      const overdueTasks = tasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < now && t.status !== "Done",
      ).length
      const openTasks = tasks.filter((t) => t.status !== "Done").length

      setSections([
        {
          title: "Document Bottlenecks",
          kpis: [
            k("Waiting for Client", "Requested, not received", Inbox, inQueue(["Requested", "Not Received"])),
            k("Under Review", "Received + under review", FileClock, inQueue(["Received", "Under Review"])),
            k("Rejected", "Needs resubmission", FileX2, inQueue(["Rejected"])),
          ],
        },
        {
          title: "Workflow by Stage",
          kpis: [
            k("Onboarding", "New → documents under review", Workflow, inStatus(["New", "Awaiting Payment", "Awaiting Documents", "Documents Under Review"])),
            k("Ready for RTO", "Awaiting submission", Send, inStatus(["Ready for Submission"])),
            k("With RTO / Provider", "Submitted + assessing", FileCheck2, inStatus(["Submitted to Source Agent", "Submitted to RTO", "RTO Acknowledged", "Under Assessment", "Additional Evidence Required"])),
            k("Rework Required", "Back with operations", CircleAlert, inStatus(["Rework Required"])),
          ],
        },
        {
          title: "Tasks & Exceptions",
          kpis: [
            k("Open Tasks", "Not yet done", ListChecks, openTasks),
            k("Overdue Tasks", "Past due date", AlarmClock, overdueTasks),
            k("Orders On Hold", "Exception queue", CircleAlert, inStatus(["On Hold"])),
          ],
        },
      ])
    })()
  }, [])

  if (!sections)
    return <p className="text-sm text-muted-foreground">Loading operations metrics…</p>

  return (
    <>
      {sections.map((s) => (
        <DashboardSection key={s.title} title={s.title} kpis={s.kpis} />
      ))}
    </>
  )
}
