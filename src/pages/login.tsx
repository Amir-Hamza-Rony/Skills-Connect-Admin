import { useState, type FormEvent } from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { LogIn } from "lucide-react"

import { useAuth } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"

/**
 * Login screen — same theme strategy as the dashboard (no light-only login).
 * Preview accepts any password for seeded accounts; the real backend
 * verifies credentials and issues short-lived session tokens.
 */
export function LoginPage() {
  const { user, authLoading, authError, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  if (!authLoading && user) {
    return <Navigate to="/dashboard" replace />
  }

  const from =
    (location.state as { from?: string } | null)?.from ?? "/dashboard"

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (!email.trim() || !password) {
      setLocalError("Enter your email and password.")
      return
    }
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch {
      // authError from context is displayed below.
    } finally {
      setSubmitting(false)
    }
  }

  const error = localError ?? authError

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
              S
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight">
                Skills Connect
              </span>
              <span className="block text-xs text-muted-foreground">
                Admin Portal
              </span>
            </span>
          </div>
          <ThemeToggle />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use a preview account — any password works in this demo shell.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@skillsconnect.example"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                <LogIn aria-hidden />
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Badge variant="info">Preview auth</Badge>
              <Badge variant="outline">admin@… / finance@… / operations@…</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
