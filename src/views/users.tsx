"use client"
import React, { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { createUser, listRoles, listUsers, updateUser } from "@/lib/store"
import { ApiError, messageFor } from "@/lib/api"
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
  const [creating, setCreating] = useState(false)
  const [draftRoles, setDraftRoles] = useState<RoleName[]>([])
  const [draftActive, setDraftActive] = useState(true)
  const [createDraft, setCreateDraft] = useState({
    email: "",
    name: "",
    phone: "",
    password: "",
    roleNames: [] as RoleName[],
    active: true,
  })
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

  function openCreate() {
    setCreating(true)
    setCreateDraft({
      email: "",
      name: "",
      phone: "",
      password: "",
      roleNames: [],
      active: true,
    })
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
      setError(messageFor(err, "Could not save changes."))
    } finally {
      setSaving(false)
    }
  }

  async function createSave() {
    setSaving(true)
    setError(null)
    try {
      const created = await createUser({
        email: createDraft.email,
        name: createDraft.name,
        phone: createDraft.phone || undefined,
        password: createDraft.password,
        roleNames: createDraft.roleNames,
        active: createDraft.active,
      })
      setUsers((prev) => (prev ? [...prev, created] : null))
      setCreating(false)
    } catch (err) {
      if (err instanceof ApiError && err.details.length > 0) {
        setError(
          err.details.map((d) => `${d.path}: ${d.message}`).join(" · "),
        )
      } else {
        setError(messageFor(err, "Could not create user."))
      }
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
      <div className="flex justify-end">
        <Button onClick={openCreate} disabled={saving}>
          {saving ? "Creating…" : "Add User"}
        </Button>
      </div>
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

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add User"
        description="Create a new staff account with a role and password."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">Email</label>
              <input
                id="create-email"
                type="email"
                value={createDraft.email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateDraft((d) => ({ ...d, email: e.target.value }))
                }
                placeholder="name@example.com"
                disabled={saving}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">Name</label>
              <input
                id="create-name"
                value={createDraft.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder="Full name"
                disabled={saving}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">Phone</label>
              <input
                id="create-phone"
                type="tel"
                value={createDraft.phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateDraft((d) => ({ ...d, phone: e.target.value }))
                }
                placeholder="+880 1xxx xxxxxx"
                disabled={saving}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">Password</label>
              <input
                id="create-password"
                type="password"
                value={createDraft.password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateDraft((d) => ({ ...d, password: e.target.value }))
                }
                placeholder="At least 12 characters"
                disabled={saving}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Roles</legend>
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createDraft.roleNames.includes(r.name)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setCreateDraft((d) => ({
                      ...d,
                      roleNames: e.target.checked
                        ? [...d.roleNames, r.name]
                        : d.roleNames.filter((n) => n !== r.name),
                    }))
                  }
                  className="size-4 accent-[var(--primary)]"
                  disabled={saving}
                />
                {r.name}
              </label>
            ))}
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createDraft.active}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setCreateDraft((d) => ({ ...d, active: e.target.checked }))
              }
              className="size-4 accent-[var(--primary)]"
              disabled={saving}
            />
            Account active
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={createSave}
              disabled={
                saving ||
                !createDraft.email ||
                !createDraft.name ||
                !createDraft.password ||
                createDraft.roleNames.length === 0
              }
            >
              {saving ? "Creating…" : "Create user"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
