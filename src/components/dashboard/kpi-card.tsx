import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export interface KpiDefinition {
  label: string
  caption: string
  icon: LucideIcon
}

/**
 * Premium KPI card in the Smart Hospital reference style:
 * tinted icon tile + label + value slot + muted caption.
 * Day-1 shows skeleton values (no fake business data — real metrics
 * wire up on Day 2–4). Structure, spacing, and theme are final.
 */
export function KpiCard({ label, caption, icon: Icon }: KpiDefinition) {
  return (
    <Card className="overflow-hidden transition-colors hover:border-primary/40">
      <CardContent className="flex items-start gap-3.5 p-4 sm:p-5">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
        >
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-muted-foreground">
            {label}
          </span>
          <Skeleton className="mt-1.5 h-7 w-20" aria-label={`${label}: waiting for data`} />
          <span className="mt-1.5 block truncate text-xs text-muted-foreground">
            {caption}
          </span>
        </span>
      </CardContent>
      <div aria-hidden className="h-0.5 w-full bg-gradient-to-r from-primary/50 via-primary/15 to-transparent" />
    </Card>
  )
}

export function DashboardSection({
  title,
  kpis,
}: {
  title: string
  kpis: KpiDefinition[]
}) {
  return (
    <section aria-label={title}>
      <h2 className="pb-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>
    </section>
  )
}
