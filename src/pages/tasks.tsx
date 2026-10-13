import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import {
  listClients,
  listOrders,
  listTasks,
  updateTaskStatus,
} from "@/lib/ops-store"
import { listUsers } from "@/lib/store"
import type { Client, Order, TaskStatus, User, WorkflowTask } from "@/lib/types"

const STATUS_VARIANT: Record<TaskStatus, "secondary" | "info" | "success" | "destructive"> = {
  Todo: "secondary",
  "In Progress": "info",
  Done: "success",
  Blocked: "destructive",
}

/** Operations task board — auto-created on stage entry, updated here. */
export function TasksPage() {
  const { user: me } = useAuth()
  const [tasks, setTasks] = useState<WorkflowTask[] | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [users, setUsers] = useState<User[]>([])

  useEffect(() => {
    void (async () => {
      const [t, o, c, u] = await Promise.all([
        listTasks(),
        listOrders(),
        listClients(),
        listUsers(),
      ])
      setTasks(t)
      setOrders(o)
      setClients(c)
      setUsers(u)
    })()
  }, [])

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  async function onStatus(t: WorkflowTask, s: TaskStatus) {
    const updated = await updateTaskStatus(t.id, s, me?.id ?? "preview-user")
    setTasks((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null)
  }

  if (!tasks) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading tasks" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Workflow</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Operational tasks · {tasks.length} open and done
          </p>
        </div>
        <Badge variant="info">Preview data</Badge>
      </div>

      <DataTable<WorkflowTask>
        rows={tasks}
        emptyMessage="No tasks — new orders auto-create onboarding tasks."
        rowLabel={(t) => t.title}
        columns={[
          {
            key: "task",
            label: "Task",
            render: (t) => (
              <span>
                <span className="font-medium">{t.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.stage}
                  {t.dueDate ? ` · due ${t.dueDate}` : ""}
                  {t.assigneeId ? ` · ${userById.get(t.assigneeId)?.name ?? t.assigneeId}` : " · unassigned"}
                </span>
              </span>
            ),
          },
          {
            key: "order",
            label: "Order",
            render: (t) => (
              <Link to={`/orders/${t.orderId}`} className="text-primary underline-offset-4 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded text-xs">
                {clientById.get(orderById.get(t.orderId)?.clientId ?? "")?.legalName ?? t.orderId}
              </Link>
            ),
          },
          {
            key: "priority",
            label: "Priority",
            render: (t) => <Badge variant="outline">{t.priority}</Badge>,
          },
          {
            key: "status",
            label: "Status",
            render: (t) => (
              <select
                aria-label={`Status for ${t.title}`}
                value={t.status}
                onChange={(e) => void onStatus(t, e.target.value as TaskStatus)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(Object.keys(STATUS_VARIANT) as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ),
          },
          {
            key: "state",
            label: "State",
            render: (t) => <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>,
          },
        ]}
      />
    </div>
  )
}
