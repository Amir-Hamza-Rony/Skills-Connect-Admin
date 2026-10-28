"use client"
import { Bell, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { useAuth } from "@/lib/auth"
import { GlobalSearch } from "@/components/global-search"
import { initialsOf } from "@/components/layout/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"

const CRUMBS: Record<string, [string, string]> = {
  "/dashboard": ["Overview", "Dashboard"],
  "/clients": ["Management", "Clients"],
  "/orders": ["Management", "Orders"],
  "/qualifications": ["Management", "Qualifications"],
  "/rtos": ["Management", "RTOs & Colleges"],
  "/agents": ["Management", "Agents"],
  "/pricing": ["Management", "Supplier Pricing"],
  "/documents": ["Operations", "Documents"],
  "/workflow": ["Operations", "Workflow"],
  "/finance": ["Operations", "Finance"],
  "/reports": ["System", "Reports"],
  "/audit": ["System", "Audit"],
  "/users": ["System", "Users"],
  "/roles": ["System", "Roles"],
  "/settings": ["System", "Settings"],
}

/**
 * Fixed top header: drawer trigger (mobile) + breadcrumb + search trigger
 * + theme switcher + notifications + user chip.
 */
export function Header({
  onOpenNav,
  onToggleCollapse,
  collapsed,
}: {
  onOpenNav: () => void
  onToggleCollapse: () => void
  collapsed?: boolean
}) {
  const pathname = usePathname()
  const { user } = useAuth()
  const [parent, current] = CRUMBS[pathname] ?? ["Overview", "Dashboard"]
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-3 sm:px-5">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="rounded-md p-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
        className="hidden rounded-md border p-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:flex"
      >
        <CollapseIcon className="size-5" aria-hidden />
      </button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
        <span className="text-muted-foreground">{parent}</span>
        <span aria-hidden className="text-muted-foreground">/</span>
        <span aria-current="page" className="truncate font-medium">
          {current}
        </span>
      </nav>

      <div className="flex-1" />

      <GlobalSearch />

      <ThemeToggle />

      <button
        type="button"
        aria-label="Notifications (coming soon)"
        className="rounded-md p-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="size-5" aria-hidden />
      </button>

      <Link
        href="/users"
        title={user ? `${user.name} — ${user.email}` : "Account"}
        aria-label="Account"
        className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
      >
        {user ? initialsOf(user.name) : "–"}
      </Link>
    </header>
  )
}
