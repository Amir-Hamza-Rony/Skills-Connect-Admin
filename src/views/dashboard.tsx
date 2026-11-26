"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"

/**
 * Dashboard entry point — redirects to the role-specific dedicated dashboard.
 *
 * After login, all users land here first and are immediately routed to the
 * dashboard matching their assigned role:
 *   SUPER_ADMIN → /dashboard/super-admin
 *   ADMIN       → /dashboard/admin
 *   B2B_AGENT   → /dashboard/b2b-agent
 *   BDC         → /dashboard/bdc-agent
 *   EMPLOYEE    → /dashboard/employee
 */
export function Dashboard() {
  const { user, authLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (authLoading || !user) return
    const roleNames = user.roleNames ?? []
    if (roleNames.includes("SUPER_ADMIN")) {
      router.replace("/dashboard/super-admin")
    } else if (roleNames.includes("ADMIN")) {
      router.replace("/dashboard/admin")
    } else if (roleNames.includes("B2B_AGENT")) {
      router.replace("/dashboard/b2b-agent")
    } else if (roleNames.includes("BDC")) {
      router.replace("/dashboard/bdc-agent")
    } else if (roleNames.includes("EMPLOYEE")) {
      router.replace("/dashboard/employee")
    } else {
      router.replace("/dashboard/employee")
    }
  }, [authLoading, user, router])

  if (authLoading || !user) return null
  return null
}
