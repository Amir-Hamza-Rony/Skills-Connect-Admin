import type { Permission, RoleName } from "@/lib/types"

/**
 * HTTP client for the real API — BACKEND-PLAN §4 "Frontend cutover".
 *
 * Credential handling (D1):
 * - The ACCESS token lives in a module-scoped variable only. It is never written
 *   to localStorage or sessionStorage, so an XSS payload cannot read it back out
 *   of persistent storage, and a page reload starts clean.
 * - The REFRESH token is an httpOnly cookie the browser attaches automatically.
 *   That is why every request uses `credentials: "include"` — without it the
 *   cookie is dropped and the session cannot be restored or rotated.
 *
 * Auto-refresh:
 * A 401 triggers one silent `POST /auth/refresh` and one retry. Concurrent 401s
 * share a SINGLE in-flight refresh promise. That is a correctness requirement,
 * not an optimisation: refresh tokens rotate, so two parallel refreshes would
 * present the same token twice and the server would correctly treat the second
 * as a replay and revoke the whole session family.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "")

/** Endpoints that must never trigger the auto-refresh path (it would loop). */
const NO_REFRESH = ["/auth/login", "/auth/refresh", "/auth/logout", "/auth/logout-all"]

let accessToken: string | null = null
let refreshInFlight: Promise<string | null> | null = null

/** Notified when the session is gone for good, so the UI can log out. */
const sessionLostListeners = new Set<() => void>()

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | undefined

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.requestId = requestId
  }

  /** Credentials were rejected — the login form should show the message. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 423
  }
}

/** Principal as the server describes it (`GET /auth/me`, `POST /auth/login`). */
export interface AuthUser {
  id: string
  email: string
  name: string
  roleNames: RoleName[]
  permissions: Permission[]
}

export interface AuthResponse {
  user: AuthUser
  accessToken: string
  tokenType: "Bearer"
  /** Access-token lifetime in seconds. */
  expiresIn: number
  refreshExpiresAt: string
}

/* ---------------- token store ---------------- */

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** Drops the in-memory token and tells the app the session ended. */
export function clearSession(): void {
  accessToken = null
  refreshInFlight = null
  for (const listener of sessionLostListeners) listener()
}

/** Registers the "session is gone" callback. Returns an unsubscribe function. */
export function onSessionLost(listener: () => void): () => void {
  sessionLostListeners.add(listener)
  return () => sessionLostListeners.delete(listener)
}

/* ---------------- internals ---------------- */

interface ErrorEnvelope {
  error?: { code?: string; message?: string; requestId?: string }
}

function toApiError(status: number, payload: unknown): ApiError {
  const envelope = payload as ErrorEnvelope | null
  return new ApiError(
    status,
    envelope?.error?.code ?? "HTTP_ERROR",
    envelope?.error?.message ?? `Request failed with status ${status}.`,
    envelope?.error?.requestId,
  )
}

async function send(
  path: string,
  method: string,
  headers: HeadersInit | undefined,
  body: unknown,
  token: string | null,
): Promise<Response> {
  const finalHeaders = new Headers(headers)
  finalHeaders.set("Accept", "application/json")
  if (token) finalHeaders.set("Authorization", `Bearer ${token}`)
  if (body !== undefined && !finalHeaders.has("Content-Type")) {
    finalHeaders.set("Content-Type", "application/json")
  }

  return fetch(`${BASE}${path}`, {
    method,
    headers: finalHeaders,
    // Sends the httpOnly refresh cookie on every call.
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** One silent rotation. Resolves the new token, or `null` if the session ended. */
async function performRefresh(): Promise<string | null> {
  try {
    const res = await send("/auth/refresh", "POST", undefined, undefined, null)
    if (!res.ok) return null
    const payload = (await readBody(res)) as AuthResponse | null
    if (!payload?.accessToken) return null
    accessToken = payload.accessToken
    return payload.accessToken
  } catch {
    // Network failure is indistinguishable from "no session" for the caller.
    return null
  }
}

/** Single-flight: concurrent 401s must not each start their own rotation. */
export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

/* ---------------- public surface ---------------- */

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  headers?: HeadersInit
  /**
   * Skip the access token and the auto-refresh path. Used by login/logout so a
   * failure there surfaces as-is instead of triggering a refresh loop.
   */
  anonymous?: boolean
}

/**
 * Calls the API and returns the parsed body, throwing `ApiError` for any
 * non-2xx response. A 401 is retried exactly once after a silent refresh.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers, anonymous = false } = options

  let res = await send(path, method, headers, body, anonymous ? null : accessToken)

  if (res.status === 401 && !anonymous && !NO_REFRESH.includes(path)) {
    const token = await refreshAccessToken()
    if (token) {
      res = await send(path, method, headers, body, token)
    } else {
      clearSession()
    }
  }

  const payload = await readBody(res)
  if (!res.ok) throw toApiError(res.status, payload)
  return payload as T
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    apiFetch<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
}

/**
 * Uploads a file as `multipart/form-data`. Used for document uploads where
 * the file bytes travel through the API into MongoDB (no presigned URLs,
 * no S3 bucket).
 *
 * The access token is sent as a Bearer header (not in FormData) so the
 * server's auth middleware can read it. The refresh-cookie still travels
 * automatically via `credentials: "include"`.
 */
export async function uploadFile<T>(
  path: string,
  formData: FormData,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "POST", anonymous = false } = options

  let res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(anonymous ? {} : { Authorization: `Bearer ${accessToken ?? ""}` }),
    },
    credentials: "include",
    body: formData,
  })

  if (res.status === 401 && !anonymous && !NO_REFRESH.includes(path)) {
    const token = await refreshAccessToken()
    if (token) {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
        body: formData,
      })
    } else {
      clearSession()
    }
  }

  const payload = await readBody(res)
  if (!res.ok) throw toApiError(res.status, payload)
  return payload as T
}

/** Human-readable message for anything thrown by `apiFetch`. */
export function messageFor(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}