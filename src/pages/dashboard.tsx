import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react"
import {
  Handshake,
  LayoutDashboard,
  Send,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react"

import { ManagementDashboard } from "@/components/dashboard/dashboard"
import { FinanceDashboardPage } from "@/pages/dashboard-finance"
import { OperationsDashboardPage } from "@/pages/dashboard-operations"
import { AgentDashboardPage } from "@/pages/dashboard-agent"
import { RtoDashboardPage } from "@/pages/dashboard-rto"
import { useAuth } from "@/lib/auth"
import { useTheme } from "@/lib/theme"
import type { RoleName } from "@/lib/types"

/* Spec §12 ships five role dashboards. They are surfaced as ONE "Dashboard"
 * nav entry with an in-page view switcher rather than five nav items — a
 * single, professional entry point where each role lands on its own default
 * view but can switch to any other. */

type ViewId = "management" | "finance" | "operations" | "agent" | "rto"

interface DashboardView {
  id: ViewId
  label: string
  icon: LucideIcon
  subtitle: string
  Component: ComponentType
}

const VIEWS: DashboardView[] = [
  {
    id: "management",
    label: "Management",
    icon: LayoutDashboard,
    subtitle: "Business overview across sales, documents, RTO and risk",
    Component: ManagementDashboard,
  },
  {
    id: "finance",
    label: "Finance",
    icon: Wallet,
    subtitle: "Invoicing, collections, margin and reconciliation",
    Component: FinanceDashboardPage,
  },
  {
    id: "operations",
    label: "Operations",
    icon: Workflow,
    subtitle: "Document queues, workflow stages and task load",
    Component: OperationsDashboardPage,
  },
  {
    id: "agent",
    label: "Agent",
    icon: Handshake,
    subtitle: "Sales pipeline, conversion and certificate delivery",
    Component: AgentDashboardPage,
  },
  {
    id: "rto",
    label: "RTO & Sourcing",
    icon: Send,
    subtitle: "Submission pipeline, turnaround and supplier performance",
    Component: RtoDashboardPage,
  },
]

/** Pick the default view for a user's roles (management for broad/admin roles). */
function defaultViewFor(roles: RoleName[]): ViewId {
  if (roles.includes("Super Admin") || roles.includes("Read Only / Manager"))
    return "management"
  if (roles.includes("Finance")) return "finance"
  if (roles.includes("RTO / Sourcing Manager")) return "rto"
  if (roles.includes("Sales / Closing Agent")) return "agent"
  if (roles.includes("Operations") || roles.includes("Document Reviewer"))
    return "operations"
  return "management"
}

export function Dashboard() {
  const { user, authLoading } = useAuth()
  const { theme, resolvedTheme } = useTheme()
  const roles = useMemo<RoleName[]>(() => user?.roleNames ?? [], [user])

  // A shared/bookmarked view (via ?view=) wins; otherwise wait for auth to
  // resolve so we pick the role default once — no flash of the wrong view.
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  )
  const urlView = params.get("view") as ViewId | null
  const [view, setView] = useState<ViewId | null>(() =>
    urlView && VIEWS.some((v) => v.id === urlView) ? urlView : null,
  )

  useEffect(() => {
    if (view === null && !authLoading) setView(defaultViewFor(roles))
  }, [view, authLoading, roles])

  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0]
  const ActiveComponent = active.Component

  const select = (id: ViewId) => {
    setView(id)
    const next = new URLSearchParams(window.location.search)
    next.set("view", id)
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${next.toString()}`,
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {active.subtitle}
            {" · "}theme {theme} ({resolvedTheme})
          </p>
        </div>
      </div>

      {/* View switcher — one Dashboard in the nav, five views in-page. */}
      <div
        role="tablist"
        aria-label="Dashboard views"
        className="flex flex-wrap gap-1 rounded-lg border bg-muted p-1"
      >
        {VIEWS.map((v) => {
          const Icon = v.icon
          const selected = v.id === active.id
          return (
            <button
              key={v.id}
              role="tab"
              aria-selected={selected}
              onClick={() => select(v.id)}
              className={
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              {v.label}
            </button>
          )
        })}
      </div>

      {view === null ? (
        <p className="text-sm text-muted-foreground">Loading dashboard…</p>
      ) : (
        <ActiveComponent />
      )}
    </div>
  )
}
