import { useEffect } from "react"
import { LogOut } from "lucide-react"
import { NavLink } from "react-router-dom"

import { useAuth } from "@/lib/auth"
import { NAV_SECTIONS } from "@/components/layout/nav"
import { ROUTE_PERMISSIONS, hasPermission } from "@/lib/permissions"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p.replace(/[^A-Za-z]/g, "").charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
        S
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight">
          Skills Connect
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          Admin Portal
        </span>
      </span>
    </div>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { permissions } = useAuth()
  return (
    <nav aria-label="Primary" className="space-y-5 px-2">
      {NAV_SECTIONS.map((section) => {
        const visible = section.items.filter((item) => {
          const required = ROUTE_PERMISSIONS[item.href]
          return !required || hasPermission(permissions, required)
        })
        if (visible.length === 0) return null
        return (
          <div key={section.title}>
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {visible.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.href}>
                    <NavLink
                      to={item.href}
                      onClick={() => onNavigate?.()}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors outline-none",
                          "focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        )
                      }
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function UserCard() {
  const { user, logout } = useAuth()
  if (!user) return null
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
        {initialsOf(user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {user.email}
        </span>
      </span>
      <button
        type="button"
        onClick={logout}
        aria-label="Sign out"
        title="Sign out"
        className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/**
 * Desktop sidebar: fixed full-height column.
 * Brand (top, static) + nav (middle, OWN scroll) + user card (bottom, static).
 */
export function Sidebar() {
  return (
    <aside className="hidden h-dvh w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="shrink-0 pt-5">
        <Brand />
      </div>
      <Separator className="mx-4 my-4 w-auto shrink-0" />
      {/* Independent scroll container #1 — sidebar nav only. */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <NavList />
      </div>
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <UserCard />
      </div>
    </aside>
  )
}

/**
 * Mobile drawer: overlay with its own scroll, Escape to close,
 * body scroll locked while open.
 */
export function SidebarDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  // Escape to close + lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex shrink-0 items-center justify-between py-5 pe-2">
          <Brand />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            // Auto-focus so Tab order starts inside the drawer.
            ref={(el) => el?.focus()}
          >
            ✕
          </button>
        </div>
        <Separator className="mx-4 mb-4 w-auto shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <NavList onNavigate={onClose} />
        </div>
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <UserCard />
        </div>
      </aside>
    </div>
  )
}
