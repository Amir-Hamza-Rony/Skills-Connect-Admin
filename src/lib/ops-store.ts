import {
  DOC_CHECKLISTS,
  type Client,
  type EvidenceStatus,
  type Order,
  type OrderDocument,
  type OrderStatus,
  type RtoSubmissionStatus,
  type TaskStatus,
  type WorkflowTask,
} from "@/lib/types"
import {
  SEED_CLIENTS,
  SEED_DOCUMENTS,
  SEED_ORDERS,
  SEED_TASKS,
} from "@/mocks/ops-seed"
import { listRoutes } from "@/lib/store"
import { auditLog } from "@/lib/fin-store"

/**
 * Preview operations layer (Day-3). Same async, REST-shaped contract as
 * lib/store.ts — the real backend replaces these functions without UI
 * changes. Snapshots, versions, and history are preserved, never rewritten.
 */

const latency = () => new Promise((r) => setTimeout(r, 120))

let clients: Client[] = structuredClone(SEED_CLIENTS)
let orders: Order[] = structuredClone(SEED_ORDERS)
let documents: OrderDocument[] = structuredClone(SEED_DOCUMENTS)
let tasks: WorkflowTask[] = structuredClone(SEED_TASKS)

const uid = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`

const nowIso = () => new Date().toISOString()

/* ---------- Clients ---------- */

export async function listClients(): Promise<Client[]> {
  await latency()
  return [...clients]
}

export async function getClient(id: string): Promise<Client | undefined> {
  await latency()
  return clients.find((c) => c.id === id)
}

export async function createClient(
  c: Omit<Client, "id" | "createdAt">,
  actorId = "preview-user",
): Promise<Client> {
  await latency()
  const created: Client = { ...c, id: uid("c"), createdAt: nowIso() }
  clients = [created, ...clients]
  auditLog("client", created.id, "create", "—", c.legalName, actorId)
  return created
}

/* ---------- Orders ---------- */

export async function listOrders(clientId?: string): Promise<Order[]> {
  await latency()
  return clientId ? orders.filter((o) => o.clientId === clientId) : [...orders]
}

export async function getOrder(id: string): Promise<Order | undefined> {
  await latency()
  return orders.find((o) => o.id === id)
}

/** Creates an order and SNAPSHOTS the current wholesale cost (Spec §8). */
export async function createOrder(
  o: {
    clientId: string
    qualificationId: string
    salesAgentId: string
    sourceAgentId: string
    rtoId: string
    sellingPrice: number
    otherCost?: number
  },
  actorId = "preview-user",
): Promise<Order> {
  await latency()
  const routes = await listRoutes()
  const route = routes.find(
    (r) =>
      r.status === "active" &&
      r.qualificationId === o.qualificationId &&
      r.sourceAgentId === o.sourceAgentId &&
      r.rtoId === o.rtoId,
  )
  const created: Order = {
    id: uid("o"),
    clientId: o.clientId,
    qualificationId: o.qualificationId,
    salesAgentId: o.salesAgentId,
    sourceAgentId: o.sourceAgentId,
    rtoId: o.rtoId,
    status: "New",
    evidenceStatus: "Not Started",
    rtoSubmissionStatus: "Not Ready",
    certificateStatus: "Not Issued",
    sellingPrice: o.sellingPrice,
    supplierCostSnapshot: route?.wholesaleCost ?? 0,
    otherCost: o.otherCost ?? 0,
    currency: "AUD",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
    history: [
      { timestamp: nowIso(), actorId, field: "status", before: "—", after: "New" },
    ],
  }
  orders = [created, ...orders]
  auditLog("order", created.id, "create", "—", `Client ${o.clientId} · AUD ${o.sellingPrice}`, actorId)
  // Auto-create the onboarding task for the new order.
  tasks = [
    {
      id: uid("t"),
      orderId: created.id,
      stage: "Onboarding",
      title: "Send document checklist to client",
      assigneeId: null,
      dueDate: null,
      status: "Todo",
      priority: "Medium",
    },
    ...tasks,
  ]
  return created
}

/** Status transition with mandatory history entry (Spec §5). */
export async function transitionOrder(
  id: string,
  to: OrderStatus,
  actorId: string,
): Promise<Order> {
  await latency()
  const i = orders.findIndex((o) => o.id === id)
  if (i === -1) throw new Error("Order not found")
  const before = orders[i].status
  orders[i] = {
    ...orders[i],
    status: to,
    updatedAt: nowIso(),
    completedAt: to === "Completed" ? nowIso() : orders[i].completedAt,
    history: [
      ...orders[i].history,
      { timestamp: nowIso(), actorId, field: "status", before, after: to },
    ],
  }
  auditLog("order", id, "status-change", before, to, actorId)
  return orders[i]
}

export async function updateOrderDimensions(
  id: string,
  patch: Partial<Pick<Order, "evidenceStatus" | "rtoSubmissionStatus">>,
  actorId: string,
): Promise<Order> {
  await latency()
  const i = orders.findIndex((o) => o.id === id)
  if (i === -1) throw new Error("Order not found")
  const changes = (Object.keys(patch) as Array<keyof typeof patch>)
    .filter((f) => patch[f] !== undefined && patch[f] !== orders[i][f])
    .map((f) => ({
      timestamp: nowIso(),
      actorId,
      field: f,
      before: String(orders[i][f]),
      after: String(patch[f]),
    }))
  orders[i] = {
    ...orders[i],
    ...patch,
    updatedAt: nowIso(),
    history: [...orders[i].history, ...changes],
  }
  for (const c of changes) auditLog("order", id, `${c.field}-change`, c.before, c.after, actorId)
  return orders[i]
}

export const grossMargin = (o: Order) =>
  o.sellingPrice - o.supplierCostSnapshot - o.otherCost

/* ---------- Documents ---------- */

export function checklistFor(_qualificationId: string): string[] {
  return DOC_CHECKLISTS.default
}

export async function listDocuments(orderId: string): Promise<OrderDocument[]> {
  await latency()
  return documents.filter((d) => d.orderId === orderId)
}

/** New version supersedes — the old approved version is never overwritten. */
export async function addDocumentVersion(
  d: Omit<OrderDocument, "id" | "version" | "storageKey">,
  actorId = "preview-user",
): Promise<OrderDocument> {
  await latency()
  const prior = documents.filter(
    (x) => x.orderId === d.orderId && x.type === d.type,
  )
  const version = prior.length === 0 ? 1 : Math.max(...prior.map((x) => x.version)) + 1
  const created: OrderDocument = {
    ...d,
    id: uid("d"),
    version,
    storageKey: `/clients/${d.clientId}/orders/${d.orderId}/${encodeURIComponent(d.type)}/${version}`,
  }
  documents = [created, ...documents]
  auditLog("document", created.id, "new-version", "—", `${d.type} v${version}`, actorId)
  return created
}

export async function reviewDocument(
  id: string,
  verdict: "Approved" | "Rejected",
  reviewerId: string,
  rejectionReason?: string,
): Promise<OrderDocument> {
  await latency()
  const i = documents.findIndex((d) => d.id === id)
  if (i === -1) throw new Error("Document not found")
  const before = documents[i].status
  documents[i] = {
    ...documents[i],
    status: verdict,
    reviewedAt: nowIso(),
    reviewedBy: reviewerId,
    rejectionReason: verdict === "Rejected" ? (rejectionReason ?? "No reason given.") : null,
  }
  auditLog("document", id, `review-${verdict.toLowerCase()}`, before, verdict, reviewerId)
  return documents[i]
}

/* ---------- Tasks ---------- */

export async function listTasks(orderId?: string): Promise<WorkflowTask[]> {
  await latency()
  return orderId ? tasks.filter((t) => t.orderId === orderId) : [...tasks]
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
  actorId = "preview-user",
): Promise<WorkflowTask> {
  await latency()
  const i = tasks.findIndex((t) => t.id === id)
  if (i === -1) throw new Error("Task not found")
  const before = tasks[i].status
  tasks[i] = { ...tasks[i], status }
  auditLog("task", id, "status-change", before, status, actorId)
  return tasks[i]
}

export type { EvidenceStatus, RtoSubmissionStatus }
