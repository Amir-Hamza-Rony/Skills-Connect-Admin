"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { LayoutDashboard, GraduationCap, Tags, Building2, Wallet, ClipboardList, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function B2BAgentDashboard() {
  const { user, authLoading } = useAuth()
  const router = useRouter()
  const [quals, setQuals] = useState<Array<{ id: string; code: string; title: string; status: string; routes: Array<{ rtoName: string; cost: number }> }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && user) {
      const roleNames = user.roleNames ?? []
      if (!roleNames.includes("B2B_AGENT") && !roleNames.includes("SUPER_ADMIN") && !roleNames.includes("ADMIN")) {
        const target = roleNames.includes("BDC")
          ? "/dashboard/bdc-agent"
          : "/dashboard/employee"
        router.replace(target)
      }
    }
  }, [authLoading, user, router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/b2b/qualifications-prices")
      if (!res.ok) {
        setError(`Failed to load qualifications (${res.status}).`)
        return
      }
      const data = await res.json()
      setQuals(data.items ?? [])
    } catch {
      setError("Could not load qualifications and prices.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Partner Overview</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            All qualifications available to you with wholesale prices from supplier routes · B2B Agent
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">B2B_AGENT</Badge>
          <span className="text-sm text-muted-foreground">{user.name} · {user.email}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 mb-4" role="alert">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Card className="border p-4"><div className="text-center"><span className="text-2xl font-bold">Qualifications Available</span><div className="mt-2">{quals.length}</div></div></Card>
        <Card className="border p-4"><div className="text-center"><span className="text-2xl font-bold">Total Price Routes</span><div className="mt-2">{quals.reduce((s, q) => s + q.routes.length, 0)}</div></div></Card>
        <Card className="border p-4"><div className="text-center"><span className="text-2xl font-bold">Active Qualifications</span><div className="mt-2">{quals.filter((q) => q.status === "current").length}</div></div></Card>
        <Card className="border p-4"><div className="text-center"><span className="text-2xl font-bold">RTOs Supplying</span><div className="mt-2">{new Set(quals.flatMap((q) => q.routes.map((r) => r.rtoName))).size}</div></div></Card>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Qualifications & Wholesale Prices</CardTitle>
          <CardDescription>Every qualification available through your RTO partnerships, with all wholesale costs from supplier routes.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : quals.length === 0 ? (
            <div className="rounded-xl border p-10 text-center">
              <p className="font-medium">No qualifications found</p>
              <p className="mt-1 text-sm text-muted-foreground">No qualifications or supplier routes have been imported yet. Use the Master Hub importer to load data.</p>
            </div>
          ) : (
            <DataTable
              rows={quals}
              emptyMessage="No qualifications available."
              rowLabel={(q) => q.code}
              columns={[
                { key: "code", label: "Code" },
                { key: "title", label: "Title" },
                { key: "status", label: "Status", render: (q) => (q.status === "current" ? <Badge variant="success">Current</Badge> : <Badge variant="outline">Superseded</Badge>) },
                {
                  key: "prices",
                  label: "Wholesale Prices (AUD)",
                  render: (q) => {
                    if (q.routes.length === 0) return <span className="text-xs text-muted-foreground">No supplier routes</span>
                    return (
                      <div className="space-y-1">
                        {q.routes.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="font-medium">{r.cost}</span>
                            <span className="text-muted-foreground">{r.rtoName}</span>
                          </div>
                        ))}
                      </div>
                    )
                  },
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Your Orders</CardTitle>
            <CardDescription>Orders submitted through your agency</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <NavLinkItem icon={ClipboardList} label="Order Pipeline" href="/orders" />
            <NavLinkItem icon={Users} label="Clients" href="/clients" />
            <NavLinkItem icon={Wallet} label="Documents" href="/documents" />
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