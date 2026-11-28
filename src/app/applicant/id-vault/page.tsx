"use client"

import { useCallback, useEffect, useState } from "react"
import { Upload, ShieldCheck, AlertCircle, CheckCircle2, FileText, User } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
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
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

/**
 * 100-Point ID Vault (/applicant/id-vault).
 *
 * Real-time 100-Point ID counter that blocks RECEIVED transition until 100
 * points are verified (docs v5.1 §2 Module 3 Step 4).
 *
 * Point values:
 *   70: Passport, Citizenship Certificate, Birth Certificate
 *   40: Australian Driver's Licence, Government Photo ID
 *   35: Work ID Card
 *   25: Medicare Card, Credit Card, Utility Bill, Bank Statement, Rental Lease Agreement, Foreign Driver's Licence
 *   20: Student ID
 */

const ID_DOCUMENTS: Array<{
  id: string
  label: string
  points: number
  accept: string
  icon: React.ElementType
}> = [
  { id: "passport", label: "Passport", points: 70, accept: ".pdf,.jpg,.jpeg,.png", icon: FileText },
  { id: "birth-certificate", label: "Birth Certificate", points: 70, accept: ".pdf,.jpg,.jpeg,.png", icon: FileText },
  { id: "citizenship-certificate", label: "Citizenship Certificate", points: 70, accept: ".pdf,.jpg,.jpeg,.png", icon: FileText },
  { id: "driver-licence", label: "Australian Driver's Licence", points: 40, accept: ".pdf,.jpg,.jpeg,.png", icon: User },
  { id: "government-photo-id", label: "Government Photo ID", points: 40, accept: ".pdf,.jpg,.jpeg,.png", icon: User },
  { id: "work-id-card", label: "Work ID Card", points: 35, accept: ".pdf,.jpg,.jpeg,.png", icon: User },
  { id: "medicare-card", label: "Medicare Card", points: 25, accept: ".pdf,.jpg,.jpeg,.png", icon: FileText },
  { id: "credit-card", label: "Credit Card", points: 25, accept: ".pdf,.jpg,.jpeg,.png", icon: FileText },
  { id: "utility-bill", label: "Utility Bill", points: 25, accept: ".pdf,.jpg,.jpeg,.png", icon: FileText },
  { id: "bank-statement", label: "Bank Statement", points: 25, accept: ".pdf,.jpg,.jpeg,.png", icon: FileText },
  { id: "rental-lease", label: "Rental Lease Agreement", points: 25, accept: ".pdf,.jpg,.jpeg,.png", icon: FileText },
  { id: "foreign-driver-licence", label: "Foreign Driver's Licence", points: 25, accept: ".pdf,.jpg,.jpeg,.png", icon: User },
  { id: "student-id", label: "Student ID", points: 20, accept: ".pdf,.jpg,.jpeg,.png", icon: User },
]

function PointsBadge({ points }: { points: number }) {
  const reached = points >= 100
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
      reached
        ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
        : "bg-amber-100 text-amber-700 border border-amber-200",
    )}>
      {points} / 100 points
    </span>
  )
}

export default function IdVaultPage() {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<Record<string, { status: "pending" | "uploaded" | "verified" | "rejected"; url?: string }>>({})
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const totalPoints = useCallback(() => {
    let points = 0
    for (const doc of ID_DOCUMENTS) {
      const d = documents[doc.id]
      if (d && d.status === "verified") points += doc.points
    }
    return points
  }, [documents])

  const reached = totalPoints() >= 100

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await api.get<{ items: any[] }>(`/documents?clientId=${user?.id}`)
        const byId: Record<string, { status: string; url?: string }> = {}
        for (const d of data.items ?? []) {
          byId[d.type] = { status: d.status, url: d.storageKey }
        }
        if (!cancelled) setDocuments(byId as any)
      } catch {
        // Ignore — documents may not exist yet.
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  async function onUpload(docId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(docId)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("clientId", user?.id ?? "")
      formData.append("orderId", "")
      formData.append("type", docId)
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("sc-access-token") ?? ""}` },
        body: formData,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error?.message ?? "Upload failed.")
        return
      }
      const data = await res.json()
      setDocuments((prev) => ({
        ...prev,
        [docId]: { status: "uploaded", url: data.storageKey },
      }))
      setSuccess(`${ID_DOCUMENTS.find((d) => d.id === docId)?.label} uploaded. Awaiting verification.`)
    } catch {
      setError("Upload failed. Try again.")
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">100-Point ID Vault</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload identity documents. You need 100 points to proceed to application RECEIVED status.
          </p>
        </div>
        <PointsBadge points={totalPoints()} />
      </div>

      <div className="w-full bg-secondary rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">Verification progress</span>
          <span className="text-xs font-semibold">{totalPoints()} / 100 points</span>
        </div>
        <div className="h-2 w-full rounded-full bg-border/50 overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${Math.min(totalPoints(), 100)}%`,
              backgroundColor: reached ? "#10b981" : "#f59e0b",
            }}
          />
        </div>
        {reached ? (
          <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" aria-hidden /> ID verified — you can proceed to RECEIVED status.
          </p>
        ) : (
          <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" aria-hidden /> {100 - totalPoints()} more points needed.
          </p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        {ID_DOCUMENTS.map((doc) => {
          const current = documents[doc.id]
          const isUploaded = current?.status === "uploaded"
          const isVerified = current?.status === "verified"
          const isRejected = current?.status === "rejected"
          return (
            <Card key={doc.id} className={cn("border-l-2", isVerified ? "border-emerald-500" : isRejected ? "border-rose-500" : "border-border")}>
              <CardHeader className="px-3 py-2 flex flex-row items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <doc.icon className="h-4 w-4" aria-hidden />
                  <CardTitle className="text-sm leading-none">{doc.label}</CardTitle>
                </div>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-border text-muted-foreground">
                  {doc.points} pts
                </span>
              </CardHeader>
              <CardContent className="px-3 py-2">
                {isUploaded && (
                  <p className="text-xs text-muted-foreground mb-2">Uploaded — awaiting staff verification.</p>
                )}
                {isVerified && (
                  <p className="text-xs text-emerald-600 mb-2 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" aria-hidden /> Verified
                  </p>
                )}
                {isRejected && (
                  <p className="text-xs text-rose-600 mb-2 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" aria-hidden /> Rejected — re-upload required.
                  </p>
                )}
                {!isUploaded && !isVerified && (
                  <label className="block cursor-pointer">
                    <Input
                      type="file"
                      accept={doc.accept}
                      onChange={(e) => onUpload(doc.id, e)}
                      className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">Upload {doc.label.toLowerCase()}</p>
                  </label>
                )}
              </CardContent>
              {uploading === doc.id && (
                <CardFooter className="px-3 py-1">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    <span className="text-xs text-muted-foreground">Uploading…</span>
                  </div>
                </CardFooter>
              )}
            </Card>
          )
        })}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-700 text-sm">
          {success}
        </div>
      )}
    </div>
  )
}
