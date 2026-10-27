import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { listRoles, listUsers, updateUser } from "@/lib/store"
import { messageFor } from "@/lib/api"
import type { Role, RoleName, User } from "@/lib/types"

function PageHeader({ count }: { count: number | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Users</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Staff accounts and role assignment
          {count !== null && ` · ${count} users`}
        </p>
      </div>
      <Badge variant="info">Live data</Badge>
    </div>
  )
}

export function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [editing, setEditing] = useState<User | null>(null)
  const [draftRoles, setDraftRoles] = useState<RoleName[]>([])
  const [draftActive, setDraftActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [u, r] = await Promise.all([listUsers(), listRoles()])
        setUsers(u)
        setRoles(r)
      } catch (err) {
        setError(messageFor(err, "Could not load users."))
        setUsers([])
      }
    })()
  }, [])

  function openEdit(u: User) {
    setEditing(u)
    setDraftRoles([...u.roleNames])
    setDraftActive(u.active)
    setError(null)
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateUser(editing.id, {
        roleNames: draftRoles,
        active: draftActive,
      })
      setUsers((prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? null)
      setEditing(null)
    } catch (err) {
      // e.g. 409 "Cannot demote or deactivate the last active Super Admin."
      setError(messageFor(err, "Could not save changes."))
    } finally {
      setSaving(false)
    }
  }

  if (!users) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <PageHeader count={null} />
        {error ? (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <Skeleton className="h-64 w-full" aria-label="Loading users" />
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <PageHeader count={users.length} />
      <DataTable<User>
        rows={users}
        emptyMessage="No staff accounts yet."
        rowLabel={(u) => u.name}
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          {
            key: "roles",
            label: "Roles",
            render: (u) => (
              <span className="flex flex-wrap gap-1">
                {u.roleNames.map((r) => (
                  <Badge key={r} variant="secondary">
                    {r}
                  </Badge>
                ))}
              </span>
            ),
          },
          {
            key: "active",
            label: "Status",
            render: (u) =>
              u.active ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="outline">Inactive</Badge>
              ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (u) => (
              <Button size="sm" variant="outline" onClick={() => openEdit(u)}>
                Edit
              </Button>
            ),
          },
        ]}
      />

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : "Edit user"}
        description="Assign roles or activate / deactivate this account."
      >
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Roles</legend>
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draftRoles.includes(r.name)}
                  onChange={(e) =>
                    setDraftRoles((prev) =>
                      e.target.checked
                        ? [...prev, r.name]
                        : prev.filter((name) => name !== r.name),
                    )
                  }
                  className="size-4 accent-[var(--primary)]"
                />
                {r.name}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draftActive}
              onChange={(e) => setDraftActive(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            Account active
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || draftRoles.length === 0}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
