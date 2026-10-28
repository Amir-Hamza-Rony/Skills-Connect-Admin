import { api, uploadFile, getAccessToken, ApiError } from "@/lib/api"
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
 * CUTOVER STATE: clients, orders, workflow tasks and documents all come from
 * the real API now. Every function keeps its original async signature, so
 * pages never change — only the body behind it does.
 *
 * Document file bytes are stored directly in MongoDB — there is no object
 * storage, no S3 bucket, and no presigned URLs. Uploading is a single
 * `multipart/form-data` POST; downloading streams bytes back from the API.
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

/* ---------- Client contact/address helpers (Spec §4B) ---------- */

/** The client's primary phone/whatsapp contact value ("" when none). */
export function primaryPhone(c: Client): string {
  const phones = (c.contacts ?? []).filter((ct) => ct.type === "phone" || ct.type === "whatsapp")
  const primary = phones.find((ct) => ct.primary) ?? phones[0]
  return primary?.value ?? ""
}

/** The client's primary email contact value, falling back to the top-level email. */
export function primaryEmail(c: Client): string {
  const emails = (c.contacts ?? []).filter((ct) => ct.type === "email")
  const primary = emails.find((ct) => ct.primary) ?? emails[0]
  return primary?.value ?? c.email
}

/** A one-line rendering of the client's primary address ("" when none). */
export function formatAddress(c: Client): string {
  const list = c.addresses ?? []
  const primary = list.find((a) => a.primary) ?? list[0]
  if (!primary) return ""
  return [primary.street, primary.city, primary.state, primary.postalCode]
    .filter(Boolean)
    .join(", ")
}

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
 * Upload a document file. Sends `multipart/form-data` with fields: `file`,
 * `orderId`, `type`. The server stores the bytes directly in MongoDB and
 * returns the document metadata.
 */
export async function uploadDocument(
  orderId: string,
  file: File,
  type: string,
  _actorId = "preview-user",
): Promise<{ document: OrderDocument }> {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("orderId", orderId)
  formData.append("type", type)
  return uploadFile(`/documents/upload`, formData)
}

/** Download a document's file bytes from the API. Returns a Blob. */
export async function downloadDocument(
  documentId: string,
): Promise<Blob> {
  const res = await fetch(`${(process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "")}/documents/${documentId}/download`, {
    method: "GET",
    headers: {
      Accept: "*/*",
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
    credentials: "include",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new ApiError(res.status, "DOWNLOAD_FAILED", text || `Download failed with status ${res.status}.`)
  }
  return res.blob()
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
