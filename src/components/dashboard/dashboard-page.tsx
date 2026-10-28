"use client"
import type { KpiDefinition } from "@/components/dashboard/kpi-card"

/** A titled group of KPI cards, shared by every role dashboard (Spec §12). */
export interface DashboardPageSection {
  title: string
  kpis: KpiDefinition[]
}
