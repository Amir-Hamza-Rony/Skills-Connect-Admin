import { useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { listRoles } from "@/lib/store"
import type { Role } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Roles matrix viewer — which permissions each Spec §11 role holds.
 * Editing the matrix itself is a Super Admin backend concern;
 * Day-2 shows the enforced contract so the business can confirm it.
 */
export function RolesPage() {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRoles(await listRoles()))()
  }, [])

  if (!roles) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-48" aria-label="Loading roles" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Roles</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Permission contract per role · {roles.length} roles
          </p>
        </div>
        <Badge variant="info">Preview data</Badge>
      </div>

      <div className="space-y-2.5">
        {roles.map((role) => {
          const expanded = open === role.id
          return (
            <div key={role.id} className="rounded-xl border bg-card">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : role.id)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-xl"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{role.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {role.permissions.length} permissions
                  </span>
                </span>
                <Badge variant="secondary">{role.permissions.length}</Badge>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </button>
              {expanded && (
                <div className="flex flex-wrap gap-1.5 border-t px-4 py-3">
                  {role.permissions.map((p) => (
                    <Badge key={p} variant="outline">
                      {p}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
