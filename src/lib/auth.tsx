import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { ApiError, api, onSessionLost, setAccessToken, type AuthUser } from "@/lib/api"
import type { Permission } from "@/lib/types"

/**
 * Real auth (Phase B2).
 *
 * Replaces the Day-2 preview that accepted any password and parked a user id in
 * localStorage:
 * - Credentials are verified by `POST /auth/login`; a wrong password is a 401
 *   from the server, not a client-side guess.
 * - The access token lives in `lib/api.ts` module memory only — never in
 *   localStorage/sessionStorage.
 * - The refresh token is an httpOnly cookie the browser attaches by itself, so a
 *   reload restores the session without the SPA ever handling a credential.
 * - Permissions come from the server, which is the single source of truth.
 */

interface AuthContextValue {
  user: AuthUser | null
  permissions: Permission[]
  authLoading: boolean
  authError: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  // When a refresh fails the session is unrecoverable; drop the principal
  // rather than leaving a signed-out UI that still believes it is signed in.
  useEffect(() => onSessionLost(() => setUser(null)), [])

  /**
   * Restore on load. `GET /auth/me` needs an access token, and there is none
   * yet, so this is where the silent-refresh path in `apiFetch` earns its keep:
   * the first call 401s, the refresh cookie rotates a new token, and the retry
   * succeeds — all inside one call. A failure just means "signed out".
   */
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const data = await api.get<{ user: AuthUser }>("/auth/me")
        if (!cancelled) setUser(data.user)
      } catch {
        /* no cookie, expired session, or API down — all mean signed out */
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null)
    try {
      // `anonymous`: a 401 here is a real credential failure and must surface
      // as-is, not trigger a pointless refresh-and-retry.
      const result = await api.post<{ user: AuthUser; accessToken: string }>(
        "/auth/login",
        { email, password },
        { anonymous: true },
      )
      setAccessToken(result.accessToken)
      setUser(result.user)
    } catch (err) {
      // The server already phrases these well: "Invalid email or password",
      // "This account is deactivated", "locked after repeated failed sign-ins".
      setAuthError(
        err instanceof ApiError ? err.message : "Could not reach the server. Is the API running?",
      )
      throw err
    }
  }, [])

  const logout = useCallback(() => {
    // `anonymous` so the cookie is still cleared server-side even when the
    // access token has already expired.
    void api.post("/auth/logout", undefined, { anonymous: true }).catch(() => {
      /* the local session is dropped regardless */
    })
    setAccessToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      permissions: user?.permissions ?? [],
      authLoading,
      authError,
      login,
      logout,
    }),
    [user, authLoading, authError, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>")
  return ctx
}