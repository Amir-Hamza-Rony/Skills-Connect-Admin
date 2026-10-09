import { ROLE_PERMISSIONS } from "@/lib/permissions"
import { auditLog } from "@/lib/fin-store"
import type {
  Agent,
  Permission,
  Qualification,
  Role,
  Rto,
  SupplierRoute,
  User,
} from "@/lib/types"
import {
  SEED_AGENTS,
  SEED_QUALIFICATIONS,
  SEED_ROLES,
  SEED_ROUTES,
  SEED_RTOS,
  SEED_USERS,
} from "@/mocks/seed"

/**
 * Preview data-access layer. Async, shaped like the future REST API
 * (GET /users, POST /agents, …) so UI code does not change when the
 * real backend lands. In-memory only — resets on reload.
 */

const latency = () => new Promise((r) => setTimeout(r, 120))

let users: User[] = structuredClone(SEED_USERS)
let agents: Agent[] = structuredClone(SEED_AGENTS)
let qualifications: Qualification[] = structuredClone(SEED_QUALIFICATIONS)
let rtos: Rto[] = structuredClone(SEED_RTOS)
let routes: SupplierRoute[] = structuredClone(SEED_ROUTES)

const uid = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`

/* ---------- Roles & users ---------- */

export async function listRoles(): Promise<Role[]> {
  await latency()
  return SEED_ROLES.map((r) => ({
    ...r,
    permissions: [...ROLE_PERMISSIONS[r.name]],
  }))
}

export async function listUsers(): Promise<User[]> {
  await latency()
  return [...users]
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, "name" | "phone" | "roleIds" | "active">>,
  actorId = "preview-user",
): Promise<User> {
  await latency()
  const i = users.findIndex((u) => u.id === id)
  if (i === -1) throw new Error("User not found")
  const before = users[i]
  users[i] = { ...users[i], ...patch }
  auditLog("user", id, "update", `roles=${before.roleIds.join(",")} active=${before.active}`, `roles=${users[i].roleIds.join(",")} active=${users[i].active}`, actorId)
  return users[i]
}

export async function permissionsFor(user: User): Promise<Permission[]> {
  await latency()
  const roles = await listRoles()
  const set = new Set<Permission>()
  for (const rid of user.roleIds) {
    const role = roles.find((r) => r.id === rid)
    role?.permissions.forEach((p) => set.add(p))
  }
  return [...set]
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
