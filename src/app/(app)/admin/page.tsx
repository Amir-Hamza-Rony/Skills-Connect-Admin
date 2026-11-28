"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { RequirePortal } from "@/components/require-auth"
import { LayoutDashboard, Users, ClipboardList, FileText, Wallet, Calendar, RefreshCw, Bell, ScrollText, UserRound, GraduationCap, Building2, Briefcase, Tags, UserCog, ShieldCheck, Settings, Cloud, Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function AdminPortal() {
  const { user, authLoading } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<Array<{ label: string; value: string }>>([])

  useEffect(() => {
    if (!authLoading && user) {
      const roleNames = user.roleNames ?? []
      // Super Admin only — redirect others to their permitted portal
      if (!roleNames.includes("SUPER_ADMIN")) {
        const target = roleNames.includes("ADMIN")
          ? "/dashboard/admin"
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
        const [qRes, rRes, aRes, uRes, oRes] = await Promise.all([
          fetch("/api/masters/qualifications"),
          fetch("/api/masters/rtos"),
          fetch("/api/masters/agents"),
          fetch("/api/users"),
          fetch("/api/orders"),
        ])
        const [q, r, a, u, o] = await Promise.all([
          qRes.json(),
          rRes.json(),
          aRes.json(),
          uRes.json(),
          oRes.json(),
        ])
        setStats([
          { label: "Qualifications", value: String(q?.items?.length ?? q?.length ?? 0) },
          { label: "RTOs & Colleges", value: String(r?.items?.length ?? r?.length ?? 0) },
          { label: "Agents", value: String(a?.items?.length ?? a?.length ?? 0) },
          { label: "Staff / Users", value: String(u?.users?.length ?? u?.length ?? 0) },
          { label: "Orders", value: String(o?.orders?.length ?? o?.length ?? 0) },
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
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Executive Overview</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Whole-of-business performance · Super Admin Portal
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="destructive">SUPER_ADMIN</Badge>
            <span className="text-sm text-muted-foreground">{user.name} · {user.email}</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <Card key={s.label} className="border p-4">
              <div className="flex items-center gap-2">
                <LayoutDashboard className="size-4 shrink-0" aria-hidden />
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
              <CardTitle>Management</CardTitle>
              <CardDescription>Clients, orders, qualifications, RTOs, agents, pricing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={Users} label="Applicants" href="/candidates" />
              <NavLinkItem icon={ClipboardList} label="Enrolments" href="/enrolments" />
              <NavLinkItem icon={GraduationCap} label="Qualifications" href="/provider/qualifications" />
              <NavLinkItem icon={Building2} label="RTO / RTO Partners" href="/provider/rtos" />
              <NavLinkItem icon={Briefcase} label="In-House Sales Team" href="/sales/agents" />
              <NavLinkItem icon={Tags} label="Pricing" href="/pricing/pricing" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider Module</CardTitle>
              <CardDescription>Qualification scopes, enrolment kits, RPL partners</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={Target} label="Qualification Scopes" href="/provider/scopes" />
              <NavLinkItem icon={FileText} label="Enrolment Kits" href="/provider/enrolment-kits" />
              <NavLinkItem icon={UserRound} label="External Agents" href="/partner/external-agents" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System</CardTitle>
              <CardDescription>Users, roles, settings, audit, reports</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={UserCog} label="Users" href="/settings/users" />
              <NavLinkItem icon={ShieldCheck} label="Roles" href="/settings/roles" />
              <NavLinkItem icon={Settings} label="Settings" href="/settings/settings" />
              <NavLinkItem icon={Bell} label="Audit" href="/settings/audit" />
              <NavLinkItem icon={ScrollText} label="Reports" href="/settings/reports" />
              <NavLinkItem icon={Cloud} label="QuickBooks" href="/settings/quickbooks" />
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
