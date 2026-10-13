import { Badge } from "@/components/ui/badge"

const CHECKS = [
  { item: "MongoDB connection", status: "Blocked — no access yet", tone: "destructive" as const },
  { item: "S3-compatible bucket", status: "Blocked — no bucket yet", tone: "destructive" as const },
  { item: "Redis / job queue", status: "Blocked — not provisioned", tone: "destructive" as const },
  { item: "QuickBooks sandbox + credentials", status: "Blocked — no credentials yet", tone: "destructive" as const },
  { item: "Source workbook (RTO & Onboarding Master Hub.xlsx)", status: "Not provided yet", tone: "warning" as const },
  { item: "QuickBooks export for reconciliation", status: "Not provided yet", tone: "warning" as const },
  { item: "Production hosting access", status: "Not confirmed yet", tone: "warning" as const },
]

const MIGRATION_STEPS = [
  "Import RTO Directory into providers and qualifications — deduplicate names/codes first.",
  "Import Price Matrix into supplier routes — normalize column-spread providers.",
  "Import Onboarding Tracker into clients and orders — manual duplicate review.",
  "Import Financial Tracker into orders, invoices, plans, payments — convert fixed instalment columns.",
  "Import Licensing & Skills Assessment into qualification references.",
  "Freeze the workbook as read-only archive; reconcile totals against QuickBooks.",
  "Duplicate-client report before enabling order creation; cutover only after reconciliation.",
]

/**
 * Settings + deployment/migration readiness (Spec §16–§17).
 * Honest external-dependency checklist — nothing is claimed working
 * without verified access.
 */
export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Environment readiness and migration plan
          </p>
        </div>
        <Badge variant="info">Preview shell</Badge>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h2 className="pb-3 text-sm font-semibold">External dependencies</h2>
        <ul className="divide-y">
          {CHECKS.map((c) => (
            <li key={c.item} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="font-medium">{c.item}</span>
              <Badge variant={c.tone}>{c.status}</Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h2 className="pb-3 text-sm font-semibold">Excel migration sequence</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          {MIGRATION_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}
