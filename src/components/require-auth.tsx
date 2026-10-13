import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"

import { useAuth } from "@/lib/auth"
import { hasPermission } from "@/lib/permissions"
import type { Permission } from "@/lib/types"
import { Skeleton } from "@/components/ui/skeleton"

/** Redirects anonymous visitors to /login (preserves intended route). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, authLoading } = useAuth()
  const location = useLocation()

  if (authLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Skeleton className="h-10 w-56" aria-label="Loading session" />
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

/**
 * UX-only permission gate. Mirrors server-side enforcement for display;
 * the future backend MUST re-check every permission on each request.
 */
export function RequirePermission({
  perm,
  children,
}: {
  perm: Permission
  children: ReactNode
}) {
  const { permissions, authLoading } = useAuth()
  if (authLoading) {
    return <Skeleton className="h-40 w-full" aria-label="Loading permissions" />
  }
  if (!hasPermission(permissions, perm)) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center">
          <h1 className="text-lg font-bold">Not authorised</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your role does not include the <code>{perm}</code> permission.
          </p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
