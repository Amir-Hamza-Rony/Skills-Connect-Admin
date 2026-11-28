"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/auth"
import { listQualifications, listRtos } from "@/lib/store"
import type { Qualification, Rto } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

export default function Level1IntakePage() {
  const { user } = useAuth()
  const router = useRouter()
  const [quals, setQuals] = useState<Qualification[]>([])
  const [rtos, setRtos] = useState<Rto[]>([])
  const [loading, setLoading] = useState(true)

  const [legalGivenNames, setLegalGivenNames] = useState("")
  const [familyName, setFamilyName] = useState("")
  const [email, setEmail] = useState("")
  const [mobile, setMobile] = useState("")
  const [interestedQualification, setInterestedQualification] = useState("")
  const [issuingRtoId, setIssuingRtoId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ id: string; enrollmentCode: string; channelType: string } | null>(null)

  useEffect(() => {
    void (async () => {
      const [q, r] = await Promise.all([listQualifications(), listRtos()])
      setQuals(q)
      setRtos(r)
      setLoading(false)
    })()
  }, [])

  const isBroker = user?.roleNames?.includes("B2B_AGENT") || user?.roleNames?.includes("EXTERNAL_BROKER") || user?.role === "B2B_AGENT" || user?.role === "EXTERNAL_BROKER"

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!legalGivenNames.trim() || !familyName.trim() || !email.trim() || !mobile.trim()) {
      setError("Legal Given Names, Family Name, Email and Mobile are required.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/applications/level-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalGivenNames: legalGivenNames.trim(),
          familyName: familyName.trim(),
          email: email.trim(),
          mobile: mobile.trim(),
          interestedQualification: interestedQualification || undefined,
          issuingRtoId: issuingRtoId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to create application.")
        return
      }
      setSuccess(data.application)
    } catch {
      setError("Could not reach the server.")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
        <Skeleton className="h-10 w-48" aria-label="Loading qualifications" />
        <Skeleton className="h-10 w-32 mt-4" aria-label="Loading RTOs" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6 space-y-6">
      {success ? (
        <div className="rounded-xl border bg-card p-6 text-center">
          <h2 className="text-lg font-bold">Application Created</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your Level 1 Quick Lead Intake has been submitted in DRAFT status.
          </p>
          <div className="mt-4 space-y-2 text-left">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Application ID</span>
              <span className="text-sm font-mono">{success.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Enrolment Code</span>
              <span className="text-sm font-mono">{success.enrollmentCode}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant="info">DRAFT</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Channel</span>
              <span className="text-sm">{success.channelType}</span>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            A passwordless Magic Link has been sent to {email}. The candidate can
            complete Level 2 AVETMISS via the link in /applicant.
          </p>
          <div className="mt-6 flex gap-2 justify-center">
            <Button onClick={() => router.push(`/applications/${success.id}/level-2`)}>
              Continue to Level 2
            </Button>
            <Button variant="outline" onClick={() => router.push("/applications/new")}>
              Create Another
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                Level 1 — Quick Lead Intake
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Create a DRAFT application for a new candidate. The candidate
                completes Level 2 AVETMISS via magic link.
              </p>
            </div>
            <Badge variant={isBroker ? "success" : "info"}>
              {isBroker ? "External B2B Broker" : "In-House BDC / Sales"}
            </Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Candidate Details</CardTitle>
              <CardDescription>
                Legal Given Names, Family Name, Email, Mobile
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="l1-given">Legal Given Names</Label>
                    <Input
                      id="l1-given"
                      value={legalGivenNames}
                      onChange={(e) => setLegalGivenNames(e.target.value)}
                      placeholder="e.g. Sarah Jane"
                      className={inputCls}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="l1-family">Family Name</Label>
                    <Input
                      id="l1-family"
                      value={familyName}
                      onChange={(e) => setFamilyName(e.target.value)}
                      placeholder="e.g. Citizen"
                      className={inputCls}
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="l1-email">Email</Label>
                    <Input
                      id="l1-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="candidate@example.com"
                      className={inputCls}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="l1-mobile">Mobile</Label>
                    <Input
                      id="l1-mobile"
                      type="tel"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="04xx xxx xxx"
                      className={inputCls}
                      required
                    />
                  </div>
                </div>
                <Card className="border-muted p-3 mb-4">
                  <CardHeader>
                    <CardTitle className="text-sm">Course & Provider</CardTitle>
                    <CardDescription>
                      Select the interested qualification and issuing RTO/partner
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="l1-qual">Interested Qualification</Label>
                      <select
                        id="l1-qual"
                        value={interestedQualification}
                        onChange={(e) => setInterestedQualification(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">Select a qualification…</option>
                        {quals.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.code} — {q.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="l1-rto">Issuing RTO / Partner</Label>
                      <select
                        id="l1-rto"
                        value={issuingRtoId}
                        onChange={(e) => setIssuingRtoId(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">Select an RTO / partner…</option>
                        {rtos.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.tradingName ?? r.legalName} ({r.rtoCode})
                          </option>
                        ))}
                      </select>
                    </div>
                  </CardContent>
                </Card>
                {error && (
                  <p role="alert" className="text-sm text-destructive">{error}</p>
                )}
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => router.push("/orders")}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating…" : "Create Application (DRAFT)"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground">
            After creating the DRAFT application, a magic link is emailed to the
            candidate so they can complete Level 2 AVETMISS in
            <Link href="/applicant" className="text-primary underline-offset-4 hover:underline">
              /applicant
            </Link>
            .
          </p>
        </>
      )}
    </div>
  )
}
