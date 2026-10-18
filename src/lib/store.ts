import { apiFetch } from "@/lib/api"
import { auditLog } from "@/lib/fin-store"
import type {
  Agent,
  Permission,
  Qualification,
  Role,
  RoleName,
  Rto,
  SupplierRoute,
  User,
  UserRef,
} from "@/lib/types"
import {
  SEED_AGENTS,
  SEED_QUALIFICATIONS,
  SEED_ROUTES,
  SEED_RTOS,
} from "@/mocks/seed"

/**
 * Data-access layer.
 *
 * CUTOVER STATE (Phase B2): users and roles now come from the real API.
 * Agents, qualifications, RTOs and supplier routes are still on the in-memory
 * preview store and switch over in B3.
 *
 * Every function keeps its original async signature, so pages never change —
 * only the body behind it does.
 */

const latency = () => new Promise((r) => setTimeout(r, 120))

let agents: Agent[] = structuredClone(SEED_AGENTS)
let qualifications: Qualification[] = structuredClone(SEED_QUALIFICATIONS)
let rtos: Rto[] = structuredClone(SEED_RTOS)
let routes: SupplierRoute[] = structuredClone(SEED_ROUTES)

const uid = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`

/* ---------- Roles & users (real API) ---------- */

interface ApiRole {
  _id: string
  name: RoleName
  description: string
  permissions: Permission[]
}

/**
 * The server is the single source of truth for the RBAC matrix
 * (`server/src/services/permissions.ts`). The local copy in
 * `lib/permissions.ts` survives only to filter nav links — it grants nothing.
 */
export async function listRoles(): Promise<Role[]> {
  const data = await apiFetch<{ roles: ApiRole[] }>("/roles")
  return data.roles.map((r) => ({
    id: r._id,
    name: r.name,
    permissions: r.permissions,
  }))
}

/** Admin listing. Server-enforced: needs `users.manage`. */
export async function listUsers(): Promise<User[]> {
  const data = await apiFetch<{ users: User[] }>("/users")
  return data.users
}

/**
 * Name-only staff list for rendering an actor id.
 *
 * Replaces the old `listUsers()` calls on the task board, document queues,
 * audit viewer, client profile and order timeline. Those screens are visible to
 * roles that are correctly refused `GET /users`, so they must not call it — a
 * 403 there would blank the page for most of the business.
 */
export async function listUserDirectory(): Promise<UserRef[]> {
  const data = await apiFetch<{ users: UserRef[] }>("/users/directory")
  return data.users
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, "name" | "phone" | "roleNames" | "active">>,
  _actorId?: string,
): Promise<User> {
  const data = await apiFetch<{ user: User }>(`/users/${id}`, { method: "PATCH", body: patch })
  return data.user
}

/* ---------- Qualifications ---------- */

export async function listQualifications(): Promise<Qualification[]> {
  await latency()
  return [...qualifications]
}

export async function createQualification(
  q: Omit<Qualification, "id" | "licensingRefs">,
  actorId = "preview-user",
): Promise<Qualification> {
  await latency()
  const created: Qualification = { ...q, id: uid("q"), licensingRefs: [] }
  qualifications = [created, ...qualifications]
  auditLog("qualification", created.id, "create", "—", q.code, actorId)
  return created
}

/* ---------- RTOs ---------- */

export async function listRtos(): Promise<Rto[]> {
  await latency()
  return [...rtos]
}

export async function createRto(r: Omit<Rto, "id">, actorId = "preview-user"): Promise<Rto> {
  await latency()
  const created: Rto = { ...r, id: uid("rto") }
  rtos = [created, ...rtos]
  auditLog("rto", created.id, "create", "—", r.tradingName, actorId)
  return created
}

/* ---------- Agents ---------- */

export async function listAgents(): Promise<Agent[]> {
  await latency()
  return [...agents]
}

export async function createAgent(a: Omit<Agent, "id">, actorId = "preview-user"): Promise<Agent> {
  await latency()
  const created: Agent = { ...a, id: uid("ag") }
  agents = [created, ...agents]
  auditLog("agent", created.id, "create", "—", `${a.name} (${a.type})`, actorId)
  return created
}

export async function updateAgent(
  id: string,
  patch: Partial<Pick<Agent, "contact" | "commissionRule" | "active">>,
  actorId = "preview-user",
): Promise<Agent> {
  await latency()
  const i = agents.findIndex((a) => a.id === id)
  if (i === -1) throw new Error("Agent not found")
  const before = agents[i].active
  agents[i] = { ...agents[i], ...patch }
  auditLog("agent", id, "update", `active=${before}`, `active=${agents[i].active}`, actorId)
  return agents[i]
}

/* ---------- Supplier routes / pricing ---------- */

export async function listRoutes(): Promise<SupplierRoute[]> {
  await latency()
  return [...routes]
}

export async function createRoute(
  r: Omit<SupplierRoute, "id">,
  actorId = "preview-user",
): Promise<SupplierRoute> {
  await latency()
  const created: SupplierRoute = { ...r, id: uid("sr") }
  routes = [created, ...routes]
  auditLog("supplier_route", created.id, "create", "—", `AUD ${r.wholesaleCost}`, actorId)
  return created
}

/** History is preserved: expiring sets status + effectiveTo, never deletes. */
export async function expireRoute(id: string, actorId = "preview-user"): Promise<SupplierRoute> {
  await latency()
  const i = routes.findIndex((r) => r.id === id)
  if (i === -1) throw new Error("Route not found")
  routes[i] = {
    ...routes[i],
    status: "expired",
    effectiveTo: new Date().toISOString().slice(0, 10),
  }
  auditLog("supplier_route", id, "expire", "active", "expired", actorId)
  return routes[i]
}

/* ---------- Display helpers ---------- */

export function qualificationLabel(q: Qualification): string {
  return `${q.code} — ${q.title}`
}

export function agentLabel(a: Agent): string {
  return a.name
}

export function rtoLabel(r: Rto): string {
  return `${r.tradingName} (${r.rtoCode})`
}
