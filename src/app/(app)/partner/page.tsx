"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { RequirePortal } from "@/components/require-auth"
import { ClipboardList, FileText, Wallet, Users, GraduationCap, Briefcase } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function PartnerPortal() {
  const { user, authLoading } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<Array<{ label: string; value: string }>>([])

  useEffect(() => {
    if (!authLoading && user) {
      const roleNames = user.roleNames ?? []
      // External B2B Broker / Partner only
      if (!roleNames.includes("EXTERNAL_BROKER") && !roleNames.includes("B2B_AGENT")) {
        const target = roleNames.includes("SUPER_ADMIN")
          ? "/admin"
          : roleNames.includes("ADMIN") || roleNames.includes("OPS_ADMIN") || roleNames.includes("ACCOUNTS")
            ? "/ops"
            : roleNames.includes("SALES_BDC") || roleNames.includes("BDC")
              ? "/sales"
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
        const [cRes, oRes] = await Promise.all([
          fetch("/api/clients"),
          fetch("/api/orders"),
        ])
        const [c, o] = await Promise.all([cRes.json(), oRes.json()])
        setStats([
          { label: "My Candidates", value: String(c?.clients?.length ?? c?.length ?? 0) },
          { label: "Applications", value: String(o?.orders?.length ?? o?.length ?? 0) },
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
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Partner Portal</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Submit B2B applications, view wholesale pricing, track candidates · Partner Portal
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default">{user.roleNames?.includes("EXTERNAL_BROKER") ? "EXTERNAL_BROKER" : "B2B_AGENT"}</Badge>
            <span className="text-sm text-muted-foreground">{user.name} · {user.email}</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="border p-4">
              <div className="flex items-center gap-2">
                <Users className="size-4 shrink-0" aria-hidden />
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
              <CardTitle>B2B Applications</CardTitle>
              <CardDescription>Submit Level 1 & Level 2 enrolment applications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={ClipboardList} label="Enrolments" href="/enrolments" />
              <NavLinkItem icon={GraduationCap} label="Qualifications" href="/provider/qualifications" />
              <NavLinkItem icon={Users} label="Applicants" href="/candidates" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Wholesale Pricing</CardTitle>
              <CardDescription>View your assigned fixed wholesale tier and prices</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={Wallet} label="External Agents" href="/partner/external-agents" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Candidates & Certificates</CardTitle>
              <CardDescription>Track candidate progress and download certificates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NavLinkItem icon={FileText} label="Documents" href="/documents" />
              <NavLinkItem icon={Briefcase} label="Workforce" href="/rpl-partners" />
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
