import { api, apiFetch } from "@/lib/api"
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
import { SEED_DOCUMENTS } from "@/mocks/ops-seed"
import { auditLog } from "@/lib/fin-store"

/**
 * Operations data-access layer.
 *
 * CUTOVER STATE (Phase B3): clients, orders and workflow tasks now come from
 * the real API. Documents stay on the in-memory preview store until B4 lands
 * the storage adapter and signed URLs — a document row is only useful once
 * there is a real file behind it.
 *
 * Every function keeps its original async signature, so pages never change —
 * only the body behind it does.
 */

const latency = () => new Promise((r) => setTimeout(r, 120))

/* ---------- Clients (real API) ---------- */

export async function listClients(): Promise<Client[]> {
  const data = await api.get<{ clients: Client[] }>("/clients")
  return data.clients
}

export async function getClient(id: string): Promise<Client | undefined> {
  try {
    const data = await api.get<{ client: Client }>(`/clients/${id}`)
    return data.client
  } catch {
    return undefined
  }
}

export async function createClient(
  c: Omit<Client, "id" | "createdAt">,
  _actorId = "preview-user",
): Promise<Client> {
  const data = await api.post<{ client: Client }>("/clients", c)
  return data.client
}

/* ---------- Orders (real API) ---------- */

export async function listOrders(clientId?: string): Promise<Order[]> {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""
  const data = await api.get<{ orders: Order[] }>(`/orders${query}`)
  return data.orders
}

export async function getOrder(id: string): Promise<Order | undefined> {
  try {
    const data = await api.get<{ order: Order }>(`/orders/${id}`)
    return data.order
  } catch {
    return undefined
  }
}

/**
 * Creates an order. The wholesale cost snapshot is taken server-side from the
 * active supplier route — the client never sends a cost, so it cannot be
 * invented or overwritten.
 */
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
  _actorId = "preview-user",
): Promise<Order> {
  const data = await api.post<{ order: Order }>("/orders", o)
  return data.order
}

/** Status transition with a mandatory history entry (Spec §5). */
export async function transitionOrder(
  id: string,
  to: OrderStatus,
  _actorId: string,
): Promise<Order> {
  const data = await api.patch<{ order: Order }>(`/orders/${id}/status`, { status: to })
  return data.order
}

export async function updateOrderDimensions(
  id: string,
  patch: Partial<Pick<Order, "evidenceStatus" | "rtoSubmissionStatus">>,
  _actorId: string,
): Promise<Order> {
  const data = await api.patch<{ order: Order }>(`/orders/${id}/dimensions`, patch)
  return data.order
}

export const grossMargin = (o: Order) =>
  o.sellingPrice - o.supplierCostSnapshot - o.otherCost

/* ---------- Documents (preview until B4) ---------- */

let documents: OrderDocument[] = structuredClone(SEED_DOCUMENTS)

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
    id: `d-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
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
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewerId,
    rejectionReason: verdict === "Rejected" ? (rejectionReason ?? "No reason given.") : null,
  }
  auditLog("document", id, `review-${verdict.toLowerCase()}`, before, verdict, reviewerId)
  return documents[i]
}

/* ---------- Tasks (real API) ---------- */

export async function listTasks(orderId?: string): Promise<WorkflowTask[]> {
  const query = orderId ? `?orderId=${encodeURIComponent(orderId)}` : ""
  const data = await api.get<{ tasks: WorkflowTask[] }>(`/workflow/tasks${query}`)
  return data.tasks
}

export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
  _actorId = "preview-user",
): Promise<WorkflowTask> {
  const data = await api.patch<{ task: WorkflowTask }>(`/workflow/tasks/${id}`, { status })
  return data.task
}

export type { EvidenceStatus, RtoSubmissionStatus }

/* Re-exported so the apiFetch import is used by callers that need raw access. */
export { apiFetch }
