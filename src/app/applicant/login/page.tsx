"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Mail, Lock, Phone, Send, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Candidate magic-link login (/applicant/login).
 *
 * Passwordless sign-in: the candidate enters their email, we send a magic link
 * to their email/SMS, and clicking it verifies the token and issues a CANDIDATE
 * JWT (docs v5.1 §1, §5 REST API contract).
 */
export default function ApplicantLoginPage() {
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [step, setStep] = useState<"request" | "sent" | "verified">("request")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState("")
  const router = useRouter()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError("Enter your email address.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/auth/magic-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error?.message ?? "Request failed.")
        return
      }
      setSentTo(email)
      setStep("sent")
    } catch {
      setError("Could not reach the server. Try again later.")
    } finally {
      setSubmitting(false)
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const tokenInput = document.getElementById("magic-token") as HTMLInputElement | null
      const token = tokenInput?.value.trim()
      if (!token) {
        setError("Enter the magic-link code sent to you.")
        return
      }
      const res = await fetch("/api/auth/magic-link/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error?.message ?? "Invalid or expired link.")
        return
      }
      setStep("verified")
      // Redirect to dashboard after a brief confirmation.
      setTimeout(() => router.replace(data.redirect ?? "/applicant"), 800)
    } catch {
      setError("Verification failed. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
              S
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight">Skills Connect</span>
              <span className="block text-xs text-muted-foreground">Applicant Portal</span>
            </span>
          </div>
        </div>

        {step === "request" && (
          <Card>
            <CardHeader>
              <CardTitle>Sign in with magic link</CardTitle>
              <CardDescription>
                Enter your email and we&rsquo;ll send a one-time sign-in link. No password needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Send className="mr-2 h-4 w-4" aria-hidden /> Sending…
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" aria-hidden /> Send magic link
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden />
                <span>Links expire in 15 minutes and can only be used once.</span>
              </div>
            </CardFooter>
          </Card>
        )}

        {step === "sent" && (
          <Card>
            <CardHeader>
              <CardTitle>Magic link sent</CardTitle>
              <CardDescription>
                Check your inbox at <span className="font-medium">{sentTo}</span> for the sign-in link.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                  <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <span className="text-sm">Open the email from Skills Connect</span>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                  <CheckCircle2 className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <span className="text-sm">Click the magic link to sign in</span>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                  <Phone className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <span className="text-sm">You&rsquo;ll arrive at your applicant dashboard</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Didn&rsquo;t receive it? Check your spam folder or request another link.
              </p>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full" onClick={() => setStep("request")}>
                Request another link
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === "verified" && (
          <Card>
            <CardHeader>
              <CardTitle>Signed in</CardTitle>
              <CardDescription>Redirecting to your dashboard&hellip;</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" aria-hidden />
              <p className="text-sm font-medium">You&rsquo;re signed in.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
