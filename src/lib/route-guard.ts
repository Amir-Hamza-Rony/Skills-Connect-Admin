/**
 * Portal route guards — docs v5.1 §6 QA #1 and v5.0 §7.
 *
 * Verify unauthorized URL navigation immediately redirects to the user's
 * permitted portal. Used in portal layout components and page guards.
 */

import type { RoleName } from "@/lib/types";
import { ROLE_PORTAL } from "@/lib/permissions";

/** All protected portal paths. */
const ALL_PORTALS = ["/admin", "/ops", "/sales", "/partner", "/applicant"];

/**
 * Given a user's roles and the current pathname, return the redirect URL if the
 * user is on a portal they are not permitted to access. Returns null if access
 * is allowed or the path is not a portal path.
 */
export function portalRedirectFor(
  roleNames: string[],
  channelType?: string | null,
  pathname?: string,
): string | null {
  if (!pathname) return null;

  // Non-portal paths are not restricted by this guard
  if (!ALL_PORTALS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return null;
  }

  // Determine which portals the user may access
  const allowedPortals = new Set<string>();
  for (const role of roleNames) {
    const portal = ROLE_PORTAL[role as RoleName];
    if (portal) allowedPortals.add(portal);
  }

  // If the user's current portal is in their allowed set, access is fine
  const currentPortal = ALL_PORTALS.find((p) => pathname === p || pathname.startsWith(p + "/"));
  if (currentPortal && allowedPortals.has(currentPortal)) return null;

  // Redirect to the first allowed portal (priority order)
  for (const role of roleNames) {
    const portal = ROLE_PORTAL[role as RoleName];
    if (portal && allowedPortals.has(portal)) return portal;
  }

  // Fallback: no allowed portal found
  return null;
}

/** Check if a role can access a specific portal path. */
export function canAccessPortal(
  roleNames: string[],
  portalPath: string,
): boolean {
  for (const role of roleNames) {
    const portal = ROLE_PORTAL[role as RoleName];
    if (portal === portalPath) return true;
  }
  return false;
}