"use client"

import { RoleDashboard } from "@/components/dashboard/role-dashboard"

/**
 * Dashboard entry point.
 *
 * The previous version exposed five in-page views (management / finance /
 * operations / agent / rto) that were rendered unconditionally, so any role
 * could open any view — including finance data it had no permission for —
 * and several views produced `NaN` because the underlying APIs mask those
 * fields. It also leaked a debug theme string into the subtitle.
 *
 * All four real roles now share one server-authorised experience. The shell
 * selects tabs and content from the verified role, while the API re-checks
 * scope and masking on every request. Frontend role checks are cosmetic only.
 */
export function Dashboard() {
  return <RoleDashboard />
}
