"use client"
import { useState, type ReactNode } from "react"

import { Header } from "@/components/layout/header"
import { Sidebar, SidebarDrawer } from "@/components/layout/sidebar"

/**
 * App shell with INDEPENDENT scrolling (design.md §10, non-negotiable):
 * - Sidebar nav has its own vertical scroll container.
 * - Main page content has a separate scroll container.
 * - Scrolling one never moves the other (separate overflow contexts).
 * - No page-level body scroll on desktop; no horizontal overflow.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sc-sidebar-collapsed") === "1"
    } catch {
      return false
    }
  })

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem("sc-sidebar-collapsed", next ? "1" : "0")
      } catch {
        /* storage unavailable — collapse still applies for this session */
      }
      return next
    })
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar collapsed={collapsed} />
      <SidebarDrawer open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          onOpenNav={() => setNavOpen(true)}
          onToggleCollapse={toggleCollapse}
          collapsed={collapsed}
        />
        {/* Independent scroll container #2 — main content only. */}
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
