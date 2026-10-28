"use client"

import { useEffect, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"

import { useAuth } from "@/lib/auth"
import { hasPermission } from "@/lib/permissions"
import type { Permission } from "@/lib/types"
import { Skeleton } from "@/components/ui/skeleton"

/** Redirects anonymous visitors to /login (preserves intended route). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, authLoading } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (authLoading || user) return
    const from =
      pathname && pathname !== "/login"
        ? `?from=${encodeURIComponent(pathname)}`
        : ""
    router.replace(`/login${from}`)
  }, [authLoading, user, pathname, router])

  if (authLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Skeleton className="h-10 w-56" aria-label="Loading session" />
      </div>
    )
  }
  if (!user) {
    return null
  }
  return <>{children}</>
}

/**
 * UX-only permission gate.
 *
 * Hiding a page the caller cannot use is a courtesy, NOT a control. The server
 * re-derives permissions from the database on every request and enforces them
 * with `requirePermission`, so navigating straight to a forbidden URL gets a
 * 403 from the API even when this component is bypassed.
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
