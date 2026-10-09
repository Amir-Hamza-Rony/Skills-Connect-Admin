import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { permissionsFor } from "@/lib/store"
import type { Permission, User } from "@/lib/types"
import { listUsers } from "@/lib/store"

const SESSION_KEY = "sc-session"

interface AuthContextValue {
  user: User | null
  permissions: Permission[]
  authLoading: boolean
  authError: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Preview auth (Day-2). Session holds ONLY the user id; the future
 * backend will issue short-lived credentials + rotated refresh tokens
 * via httpOnly cookies — never localStorage tokens.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        const id = localStorage.getItem(SESSION_KEY)
        if (id) {
          const all = await listUsers()
          const found = all.find((u) => u.id === id && u.active)
          if (found && !cancelled) {
            setUser(found)
            setPermissions(await permissionsFor(found))
          } else {
            localStorage.removeItem(SESSION_KEY)
          }
        }
      } catch {
        /* preview store unavailable — stay logged out */
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, _password: string) => {
    setAuthError(null)
    const all = await listUsers()
    const found = all.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
    )
    if (!found) {
      setAuthError("No account found for this email (preview accounts only).")
      throw new Error("unknown-account")
    }
    if (!found.active) {
      setAuthError("This account is deactivated. Contact an administrator.")
      throw new Error("inactive-account")
    }
    // Preview accepts any password; real backend verifies credentials.
    setUser({ ...found, lastLoginAt: new Date().toISOString() })
    setPermissions(await permissionsFor(found))
    try {
      localStorage.setItem(SESSION_KEY, found.id)
    } catch {
      /* session stays in memory only */
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    setPermissions([])
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      /* noop */
    }
  }, [])

  const value = useMemo(
    () => ({ user, permissions, authLoading, authError, login, logout }),
    [user, permissions, authLoading, authError, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>")
  return ctx
}
