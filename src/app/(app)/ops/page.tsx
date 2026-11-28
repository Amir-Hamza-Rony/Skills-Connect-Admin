"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { RequirePortal } from "@/components/require-auth"
import { ClipboardList, FileText, Wallet, Calendar, RefreshCw, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function OpsPortal() {
  const { user, authLoading } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<Array<{ label: string; value: string }>>([])

  useEffect(() => {
    if (!authLoading && user) {
      const roleNames = user.roleNames ?? []
      // Ops Admin / Accounts only
      if (!roleNames.includes("OPS_ADMIN") && !roleNames.includes("ACCOUNTS")) {
        const target = roleNames.includes("SUPER_ADMIN")
          ? "/admin"
          : roleNames.includes("B2B_AGENT")
            ? "/dashboard/b2b-agent"
            : roleNames.includes("BDC")
              ? "/dashboard/bdc-agent"
              : roleNames.includes("CANDIDATE")
                ? "/applicant"
                : "/dashboard/employee"
        router.replace(target)
      }
    }
  }, [authLoading, user, router])

  useEffect(() => {
    void (async () => {
      try {
        const [cRes, oRes, dRes, tRes] = await Promise.all([
          fetch("/api/clients"),
          fetch("/api/orders"),
          fetch("/api/documents"),
          fetch("/api/workflow/tasks"),
        ])
        const [c, o, d, t] = await Promise.all([
          cRes.json(),
          oRes.json(),
          dRes.json(),
          tRes.json(),
        ])
        setStats([
          { label: "Clients", value: String(c?.clients?.length ?? c?.length ?? 0) },
          { label: "Orders", value: String(o?.orders?.length ?? o?.length ?? 0) },
          { label: "Documents", value: String(d?.documents?.length ?? d?.length ?? 0) },
          { label: "Open Tasks", value: String(t?.tasks?.length ?? t?.length ?? 0) },
        ])
      } catch {
        /* stats optional */
      }
    })()
  }, [])

  if (authLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }
  if (!user) return null

  return (
    <RequirePortal>
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Operations Centre</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Verify 100-point ID, lodge portfolios, upload certificates · Ops Admin & Accounts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default">{user.roleNames?.includes("ACCOUNTS") ? "ACCOUNTS" : "OPS_ADMIN"}</Badge>
            <span className="text-sm text-muted-foreground">{user.name} · {user.email}</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="border p-4">
              <div className="flex items-center gap-2">
                <ClipboardList className="size-4 shrink-0" aria-hidden />
                <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
              </div>
              <div className="mt-2 text-2xl font-bold">{s.value}</div>
            </Card>
          ))}
        </div>

        <Separator />

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Client Management</CardTitle>
              <CardDescription>Applicants, enrolments, ID verification</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={Users} label="Applicants" href="/candidates" />
              <NavLinkItem icon={ClipboardList} label="Enrolments" href="/enrolments" />
              <NavLinkItem icon={FileText} label="Documents" href="/documents" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Finance & Commission</CardTitle>
              <CardDescription>Invoices, payments, commission payouts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={Wallet} label="Finance" href="/finance/finance" />
              <NavLinkItem icon={Calendar} label="Commission Records" href="/finance/commission-records" />
              <NavLinkItem icon={Wallet} label="Commission Payouts" href="/finance/commission-payouts" />
              <NavLinkItem icon={RefreshCw} label="BDC Commission Ledger" href="/finance/bdc-commission-ledger" />
              <NavLinkItem icon={RefreshCw} label="Reconciliation" href="/settings/reconciliation" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Operations</CardTitle>
              <CardDescription>Workflow, RTO processing, certificate deliveries</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={FileText} label="Workflow" href="/workflow" />
              <NavLinkItem icon={FileText} label="RTO Processing" href="/rto-processing" />
              <NavLinkItem icon={FileText} label="Certificate Deliveries" href="/certificate-deliveries" />
            </CardContent>
          </Card>
        </div>
      </div>
    </RequirePortal>
  )
}

function NavLinkItem({ icon: Icon, label, href }: { icon: any; label: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </a>
  )
}
