import { Bell, Menu, Search } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"

/**
 * Fixed top header: drawer trigger (mobile) + breadcrumb + search trigger
 * + theme switcher + notifications + user chip.
 */
export function Header({ onOpenNav }: { onOpenNav: () => void }) {
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

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
        <span className="text-muted-foreground">Overview</span>
        <span aria-hidden className="text-muted-foreground">/</span>
        <span aria-current="page" className="truncate font-medium">
          Dashboard
        </span>
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        aria-label="Search (coming soon)"
        title="Search — coming soon"
        className="hidden h-9 items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex md:w-64"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Search clients, orders…</span>
      </button>

      <ThemeToggle />

      <button
        type="button"
        aria-label="Notifications (coming soon)"
        className="rounded-md p-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="size-5" aria-hidden />
      </button>

      <span
        className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground sm:flex"
        aria-hidden
      >
        AD
      </span>
    </header>
  )
}
