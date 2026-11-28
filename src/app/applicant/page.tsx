"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default function ApplicantDashboard() {
  const { user } = useAuth()
  const [applications, setApplications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setLoading(true)
        const data = await api.get<{ items: any[] }>("/applications")
        if (!cancelled) setApplications(data.items ?? [])
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Unable to load applications.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="animate-pulse rounded-full h-8 w-8 bg-muted" />
      </div>
    )
  }

  const channelB2B = user?.channelType === "EXTERNAL_BROKER"
  const statusCounts: Record<string, number> = {}
  for (const a of applications) {
    statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Welcome back, {user?.name}. Here are your active applications.
          </p>
        </div>
        <Badge variant="secondary">
          {channelB2B ? "Enrolled via broker" : "Direct enrolment"}
        </Badge>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Total Applications</CardTitle>
            <CardDescription className="text-xs">{applications.length}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-3 gap-2 text-xs">
              {Object.entries(statusCounts).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{status}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Your ID Points</CardTitle>
            <CardDescription className="text-xs">Verified identity documents</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold">0</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload ID documents to reach 100 points.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Next Step</CardTitle>
            <CardDescription className="text-xs">What to do now</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-baseline gap-1">
              <span className="font-semibold">Complete Level 2 enrolment</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Fill in your AVETMISS details and upload evidence.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Applications</CardTitle>
          <CardDescription className="text-xs">Your enrolment pipeline</CardDescription>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications yet.</p>
          ) : (
            <div className="space-y-2">
              {applications.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-2 rounded-lg border border-border/60">
                  <div>
                    <span className="font-medium">{a.qualification ?? "Qualification"}</span>
                    <p className="text-xs text-muted-foreground">{a.courseCode ?? ""}</p>
                  </div>
                  <Badge
                    variant={
                      a.status === "DELIVERED"
                        ? "default"
                        : a.status === "IN_PROGRESS"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {a.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
