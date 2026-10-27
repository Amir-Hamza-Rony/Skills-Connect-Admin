import { api, apiFetch } from "@/lib/api"
import type { Communication, SavedView, SavedViewScope } from "@/lib/types"

/**
 * Data access for saved operational views (Spec §13) and the client
 * communications log (Spec §7), plus the report endpoints added in Spec §4K.
 *
 * Every function keeps an async signature and calls the real API, matching the
 * ops/finance store conventions.
 */

/* ---------------- Saved views ---------------- */

export async function listSavedViews(scope?: SavedViewScope): Promise<SavedView[]> {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : ""
  const data = await api.get<{ savedViews: SavedView[] }>(`/saved-views${query}`)
  return data.savedViews
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  filters: Record<string, unknown>
  isDefault?: boolean
}): Promise<SavedView> {
  const data = await api.post<{ savedView: SavedView }>("/saved-views", input)
  return data.savedView
}

export async function updateSavedView(
  id: string,
  patch: { name?: string; filters?: Record<string, unknown>; isDefault?: boolean },
): Promise<SavedView> {
  const data = await api.patch<{ savedView: SavedView }>(`/saved-views/${id}`, patch)
  return data.savedView
}

export async function deleteSavedView(id: string): Promise<void> {
  await apiFetch<unknown>(`/saved-views/${id}`, { method: "DELETE" })
}

/* ---------------- Communications ---------------- */

export interface CommunicationFilter {
  clientId?: string
  orderId?: string
  channel?: Communication["channel"]
  direction?: Communication["direction"]
  status?: Communication["status"]
}

export async function listCommunications(
  filter: CommunicationFilter = {},
): Promise<Communication[]> {
  const params = new URLSearchParams()
  if (filter.clientId) params.set("clientId", filter.clientId)
  if (filter.orderId) params.set("orderId", filter.orderId)
  if (filter.channel) params.set("channel", filter.channel)
  if (filter.direction) params.set("direction", filter.direction)
  if (filter.status) params.set("status", filter.status)
  const query = params.toString()
  const data = await api.get<{ communications: Communication[] }>(
    `/communications${query ? `?${query}` : ""}`,
  )
  return data.communications
}

export async function createCommunication(input: {
  clientId: string
  orderId?: string | null
  channel: Communication["channel"]
  direction: Communication["direction"]
  message: string
  status?: Communication["status"]
  sentAt?: string | null
  externalReference?: string | null
}): Promise<Communication> {
  const data = await api.post<{ communication: Communication }>("/communications", input)
  return data.communication
}

/* ---------------- Reports (Spec §4K additions) ---------------- */

export interface RevenueByMonthRow {
  month: string
  invoiced: number
  collected: number
  orders: number
}

export interface RevenueBySupplierGroup {
  name: string
  orders: number
  revenue: number
}

export interface DocumentCompletionRow {
  type: string
  total: number
  approved: number
  rejected: number
  approvalRate: number
  rejectionRate: number
}

export interface CertificateCompletionTime {
  count: number
  averageDays: number
  medianDays: number
  minDays: number
  maxDays: number
}

export function revenueByMonth() {
  return api.get<{ months: RevenueByMonthRow[] }>("/reports/revenue-by-month")
}

export function revenueBySupplier() {
  return api.get<{
    bySourceAgent: RevenueBySupplierGroup[]
    byRto: RevenueBySupplierGroup[]
  }>("/reports/revenue-by-supplier")
}

export function documentCompletion() {
  return api.get<{ byType: DocumentCompletionRow[] }>("/reports/document-completion")
}

export function certificateCompletionTime() {
  return api.get<CertificateCompletionTime>("/reports/certificate-completion-time")
}
