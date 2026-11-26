"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { LayoutDashboard, Users, ClipboardList, FileText, Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function EmployeeDashboard() {
  const { user, authLoading } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<Array<{ label: string; value: string }>>([])

  useEffect(() => {
    if (!authLoading && user) {
      const roleNames = user.roleNames ?? []
      if (!roleNames.includes("EMPLOYEE") && !roleNames.includes("SUPER_ADMIN") && !roleNames.includes("ADMIN")) {
        const target = roleNames.includes("B2B_AGENT")
          ? "/dashboard/b2b-agent"
          : roleNames.includes("BDC")
            ? "/dashboard/bdc-agent"
            : "/dashboard"
        router.replace(target)
      }
    }
  }, [authLoading, user, router])

  useEffect(() => {
    void (async () => {
      try {
        const [tRes, oRes] = await Promise.all([
          fetch("/api/workflow/tasks"),
          fetch("/api/orders"),
        ])
        const [t, o] = await Promise.all([tRes.json(), oRes.json()])
        setStats([
          { label: "Assigned Tasks", value: String(t?.tasks?.length ?? t?.length ?? 0) },
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
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Employee Portal</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Assigned tasks and orders · Employee</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">EMPLOYEE</Badge>
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
            <CardTitle>Tasks</CardTitle>
            <CardDescription>Workflow tasks assigned to you</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <NavLinkItem icon={ClipboardList} label="Workflow" href="/workflow" />
            <NavLinkItem icon={Calendar} label="Tasks" href="/workflow" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders & Clients</CardTitle>
            <CardDescription>Orders and clients in your scope</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <NavLinkItem icon={Users} label="Clients" href="/clients" />
            <NavLinkItem icon={ClipboardList} label="Orders" href="/orders" />
            <NavLinkItem icon={FileText} label="Documents" href="/documents" />
          </CardContent>
        </Card>
      </div>
    </div>
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