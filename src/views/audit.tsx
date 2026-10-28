"use client"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { listUserDirectory } from "@/lib/store"
import type { UserRef } from "@/lib/types"

const inputCls =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

interface AuditEventDTO {
  id: string
  timestamp: string
  actorId: string | null
  actorEmail: string | null
  entityType: string
  entityId: string | null
  action: string
  before: unknown
  after: unknown
}

/**
 * Immutable audit trail viewer — every financial/status mutation lands here.
 *
 * CUTOVER STATE (B6): this page read an in-memory preview store, so it showed
 * only events created during the current session. It now reads `GET /audit`,
 * which is the append-only collection, so history survives a reload and the
 * viewer agrees with what was actually written.
 *
 * Filtering is server-side. The collection grows on every mutation in the
 * system, so pulling it whole would transfer thousands of rows to answer "what
 * changed on order X".
 */
export function AuditPage() {
  const [events, setEvents] = useState<AuditEventDTO[] | null>(null)
  const [users, setUsers] = useState<UserRef[]>([])
  const [entityTypes, setEntityTypes] = useState<string[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [entityType, setEntityType] = useState("")
  const [action, setAction] = useState("")
  const [search, setSearch] = useState("")

  useEffect(() => {
    void api.get<{ entityTypes: string[]; actions: string[] }>("/audit/filters").then((res) => {
      setEntityTypes(res.entityTypes)
      setActions(res.actions)
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (entityType) params.set("entityType", entityType)
    if (action) params.set("action", action)
    if (search.trim()) params.set("search", search.trim())
    params.set("pageSize", "100")

    const res = await api.get<{ events: AuditEventDTO[]; total: number }>(
      `/audit?${params.toString()}`,
    )
    setEvents(res.events)
    setTotal(res.total)
    setLoading(false)
  }, [entityType, action, search])

  useEffect(() => {
    const t = setTimeout(() => void load(), 250)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    void listUserDirectory().then(setUsers)
  }, [])

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Audit Log</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Append-only business history · {loading ? "…" : `${events?.length ?? 0} of ${total} events`}
          </p>
        </div>
        <Badge variant="success">Live data</Badge>
      </div>

      <div className="flex flex-wrap gap-2 pb-4">
        <select
          aria-label="Filter by entity type"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className={`${inputCls} w-auto`}
        >
          <option value="">All entity types</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className={`${inputCls} w-auto`}
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input
          aria-label="Search audit events"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search action, entity, values…"
          className={`${inputCls} w-64`}
        />
      </div>

      {events === null ? (
        <Skeleton className="h-64 w-full" aria-label="Loading audit log" />
      ) : (
        <DataTable<AuditEventDTO>
          rows={events}
          emptyMessage="No events match."
          rowLabel={(e) => `${e.action} ${e.entityId ?? ""}`}
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
                <span className="text-xs">
                  {e.actorEmail ?? userById.get(e.actorId ?? "")?.name ?? e.actorId ?? "system"}
                </span>
              ),
            },
            {
              key: "entity",
              label: "Entity",
              render: (e) => (
                <span className="text-xs">
                  <Badge variant="secondary">{e.entityType}</Badge>{" "}
                  <code>{e.entityId ?? "—"}</code>
                </span>
              ),
            },
            { key: "action", label: "Action" },
            {
              key: "change",
              label: "Before → After",
              render: (e) => (
                <span className="text-xs text-muted-foreground">
                  {String(e.before ?? "—")} → <span className="text-foreground">{String(e.after ?? "—")}</span>
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}