import { api } from "@/lib/api"
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

/**
 * Operations data-access layer.
 *
 * CUTOVER STATE (Phase B4): clients, orders, workflow tasks and documents all
 * come from the real API now. Every function keeps its original async
 * signature, so pages never change — only the body behind it does.
 *
 * Documents no longer carry a `storageKey`: files live in object storage and
 * are fetched with a short-lived presigned URL, so the raw key never reaches
 * the browser. Uploading is a two-step dance — `requestUploadUrl` then
 * `confirmUpload` — rather than a single call.
 */

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

/* ---------- Documents (real API) ---------- */

/** The per-order document checklist template. Static, so it stays client-side. */
export function checklistFor(_qualificationId: string): string[] {
  return DOC_CHECKLISTS.default
}

export async function listDocuments(orderId: string): Promise<OrderDocument[]> {
  const data = await api.get<{ documents: OrderDocument[] }>(`/orders/${orderId}/documents`)
  return data.documents
}

/**
 * Step 1 of an upload: ask the server for a presigned PUT URL.
 *
 * The server picks the version and the storage key; the client only learns the
 * signed URL. The file bytes go straight to storage, never through the API.
 */
export async function requestUploadUrl(
  orderId: string,
  type: string,
  contentType: string,
  _actorId = "preview-user",
): Promise<{ uploadUrl: string; document: OrderDocument }> {
  return api.post("/documents/upload-url", { orderId, type, contentType })
}

/** Step 2 of an upload: confirm the file landed so the status becomes Received. */
export async function confirmUpload(
  documentId: string,
  _actorId = "preview-user",
): Promise<OrderDocument> {
  const data = await api.post<{ document: OrderDocument }>(
    `/documents/${documentId}/confirm-upload`,
  )
  return data.document
}

/** A short-lived download URL. The server logs the access. */
export async function requestDownloadUrl(
  documentId: string,
): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  return api.get(`/documents/${documentId}/download-url`)
}

export async function reviewDocument(
  id: string,
  verdict: "Approved" | "Rejected",
  _reviewerId: string,
  rejectionReason?: string,
): Promise<OrderDocument> {
  return api.patch(`/documents/${id}/review`, { verdict, reason: rejectionReason })
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
