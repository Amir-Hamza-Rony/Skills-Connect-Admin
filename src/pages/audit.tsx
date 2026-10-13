import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { Skeleton } from "@/components/ui/skeleton"
import { listAudit } from "@/lib/fin-store"
import { listUsers } from "@/lib/store"
import type { AuditEvent, User } from "@/lib/types"

const inputCls =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** Immutable audit trail viewer — every financial/status mutation lands here. */
export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [fType, setFType] = useState("")
  const [query, setQuery] = useState("")

  useEffect(() => {
    void (async () => {
      setEvents(await listAudit())
      setUsers(await listUsers())
    })()
  }, [])

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const types = useMemo(
    () => [...new Set((events ?? []).map((e) => e.entityType))],
    [events],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (events ?? []).filter(
      (e) =>
        (!fType || e.entityType === fType) &&
        (!q ||
          e.action.toLowerCase().includes(q) ||
          e.entityId.toLowerCase().includes(q) ||
          e.before.toLowerCase().includes(q) ||
          e.after.toLowerCase().includes(q)),
    )
  }, [events, fType, query])

  if (!events) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading audit log" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Audit Log</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Append-only business history · {visible.length} of {events.length} events
          </p>
        </div>
        <Badge variant="info">Preview data</Badge>
      </div>

      <div className="flex flex-wrap gap-2 pb-4">
        <select aria-label="Filter by entity type" value={fType} onChange={(e) => setFType(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">All entity types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          aria-label="Search audit events"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search action, entity, values…"
          className={`${inputCls} w-64`}
        />
      </div>

      <DataTable<AuditEvent>
        rows={visible}
        emptyMessage="No events match."
        rowLabel={(e) => `${e.action} ${e.entityId}`}
        columns={[
          {
            key: "timestamp",
            label: "When",
            render: (e) => (
              <span className="whitespace-nowrap tabular-nums text-xs">
                {new Date(e.timestamp).toLocaleString()}
              </span>
            ),
          },
          {
            key: "actor",
            label: "Actor",
            render: (e) => (
              <span className="text-xs">{userById.get(e.actorId)?.name ?? e.actorId}</span>
            ),
          },
          {
            key: "entity",
            label: "Entity",
            render: (e) => (
              <span className="text-xs">
                <Badge variant="secondary">{e.entityType}</Badge>{" "}
                <code>{e.entityId}</code>
              </span>
            ),
          },
          { key: "action", label: "Action" },
          {
            key: "change",
            label: "Before → After",
            render: (e) => (
              <span className="text-xs text-muted-foreground">
                {e.before} → <span className="text-foreground">{e.after}</span>
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}
