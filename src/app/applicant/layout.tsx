"use client"

import { useEffect, useState, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"

import { RequirePortal } from "@/components/require-auth"
import { useAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * Candidate portal layout (/applicant).
 *
 * Wrapped in RequirePortal so a candidate who lands here without the CANDIDATE
 * role is redirected to their permitted portal (docs v5.1 §6 QA #1).
 *
 * Independent scroll regions mirror the admin AppShell design.
 */
export default function ApplicantLayout({ children }: { children: ReactNode }) {
  const { user, authLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [navOpen, setNavOpen] = useState(false)

  if (authLoading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="animate-pulse rounded-full h-8 w-8 bg-muted" />
      </div>
    )
  }

  return (
    <RequirePortal>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <aside className="hidden md:flex w-60 flex-col border-r border-border bg-secondary/30">
          <div className="p-6 flex items-center gap-2">
            <span className="size-8 rounded-lg bg-primary flex items-center justify-center text-lg font-bold text-primary-foreground">
              S
            </span>
            <span className="font-semibold text-sm tracking-tight">Skills Connect</span>
          </div>
          <nav className="mt-6 space-y-1 px-4">
            <a
              href="/applicant"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                pathname === "/applicant" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
              onClick={() => setNavOpen(false)}
            >
              Dashboard
            </a>
            <a
              href="/applicant/id-vault"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                pathname.startsWith("/applicant/id-vault") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
              onClick={() => setNavOpen(false)}
            >
              100-Point ID Vault
            </a>
            <a
              href="/applicant/usi"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                pathname.startsWith("/applicant/usi") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
              onClick={() => setNavOpen(false)}
            >
              USI Verification
            </a>
            <a
              href="/applicant/avetmiss"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                pathname.startsWith("/applicant/avetmiss") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
              onClick={() => setNavOpen(false)}
            >
              Enrolment Form
            </a>
            <a
              href="/applicant/evidence"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                pathname.startsWith("/applicant/evidence") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
              onClick={() => setNavOpen(false)}
            >
              Evidence Upload
            </a>
            <a
              href="/applicant/certificate"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                pathname.startsWith("/applicant/certificate") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
              }`}
              onClick={() => setNavOpen(false)}
            >
              Certificate
            </a>
          </nav>
          <div className="mt-auto p-4 border-t border-border">
            <Button
              variant="outline"
              onClick={() => {
                localStorage.removeItem("sc-access-token")
                router.replace("/login")
              }}
              className="w-full"
            >
              Sign out
            </Button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background px-6">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold">{pageTitle(pathname)}</h1>
              <span className="h-3 w-3 rounded-full bg-emerald-500" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{user.email}</span>
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {user.role}
              </span>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
            {children}
          </main>
        </div>
      </div>
    </RequirePortal>
  )
}

function pageTitle(pathname: string): string {
  if (pathname === "/applicant") return "Dashboard"
  if (pathname.startsWith("/applicant/id-vault")) return "100-Point ID Vault"
  if (pathname.startsWith("/applicant/usi")) return "USI Verification"
  if (pathname.startsWith("/applicant/avetmiss")) return "Enrolment Form"
  if (pathname.startsWith("/applicant/evidence")) return "Evidence Upload"
  if (pathname.startsWith("/applicant/certificate")) return "Certificate"
  return "Applicant Portal"
}
