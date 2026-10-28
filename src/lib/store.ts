import { apiFetch } from "@/lib/api"
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

/**
 * Data-access layer.
 *
 * CUTOVER STATE: everything is on the real API.
 *
 * Users and roles moved in B2; agents, qualifications, RTOs and supplier routes
 * moved in B3. Before that the masters served synthetic in-memory data while
 * the orders snapshotting their wholesale cost were already real — so the
 * pricing matrix on screen was not the matrix an order was priced from. Both
 * looked correct, which is what made it dangerous.
 *
 * Every function keeps its original async signature, so pages never change —
 * only the body behind it does.
 */

/* ---------- Roles & users ---------- */

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
): Promise<User> {
  const data = await apiFetch<{ user: User }>(`/users/${id}`, { method: "PATCH", body: patch })
  return data.user
}

/** Create a new staff account (needs `users.manage`). */
export async function createUser(input: {
  email: string
  name: string
  phone?: string
  password: string
  roleNames: RoleName[]
  active?: boolean
}): Promise<User> {
  const data = await apiFetch<{ user: User }>("/users", {
    method: "POST",
    body: input,
  })
  return data.user
}

/* ---------- Qualifications ---------- */

export async function listQualifications(): Promise<Qualification[]> {
  const data = await apiFetch<{ qualifications: Qualification[] }>("/qualifications")
  return data.qualifications
}

export async function createQualification(
  q: Omit<Qualification, "id" | "licensingRefs">,
): Promise<Qualification> {
  const data = await apiFetch<{ qualification: Qualification }>("/qualifications", {
    method: "POST",
    body: q,
  })
  return data.qualification
}

/* ---------- RTOs ---------- */

export async function listRtos(): Promise<Rto[]> {
  const data = await apiFetch<{ rtos: Rto[] }>("/rtos")
  return data.rtos
}

export async function createRto(r: Omit<Rto, "id">): Promise<Rto> {
  const data = await apiFetch<{ rto: Rto }>("/rtos", { method: "POST", body: r })
  return data.rto
}

/* ---------- Agents ---------- */

export async function listAgents(): Promise<Agent[]> {
  const data = await apiFetch<{ agents: Agent[] }>("/agents")
  return data.agents
}

export async function createAgent(a: Omit<Agent, "id">): Promise<Agent> {
  const data = await apiFetch<{ agent: Agent }>("/agents", { method: "POST", body: a })
  return data.agent
}

export async function updateAgent(
  id: string,
  patch: Partial<Pick<Agent, "contact" | "commissionRule" | "active">>,
): Promise<Agent> {
  const data = await apiFetch<{ agent: Agent }>(`/agents/${id}`, { method: "PATCH", body: patch })
  return data.agent
}

/* ---------- Supplier routes / pricing ---------- */

export async function listRoutes(): Promise<SupplierRoute[]> {
  const data = await apiFetch<{ routes: SupplierRoute[] }>("/supplier-routes")
  return data.routes
}

/**
 * A cost change is recorded by expiring the old route and creating a new one.
 * Orders already created keep their own snapshot either way.
 */
export async function createRoute(r: Omit<SupplierRoute, "id">): Promise<SupplierRoute> {
  const data = await apiFetch<{ route: SupplierRoute }>("/supplier-routes", {
    method: "POST",
    body: r,
  })
  return data.route
}

/** History is preserved: expiring sets status + effectiveTo on the server, never deletes. */
export async function expireRoute(id: string): Promise<SupplierRoute> {
  const data = await apiFetch<{ route: SupplierRoute }>(`/supplier-routes/${id}/expire`, {
    method: "POST",
    body: {},
  })
  return data.route
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