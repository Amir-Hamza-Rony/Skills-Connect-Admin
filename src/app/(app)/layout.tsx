import type { ReactNode } from "react"

import { AppShell } from "@/components/layout/app-shell"
import { RequireAuth } from "@/components/require-auth"

/**
 * Authenticated area. Everything below this layout is wrapped in the same
 * shell (sidebar + header + independent scroll regions) the SPA used.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  )
}
