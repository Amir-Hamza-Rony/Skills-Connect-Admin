"use client"

import { useCallback, useEffect, useState } from "react"
import { Upload, FileText, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
 * Evidence Upload (/applicant/evidence).
 *
 * Upload slots for Academic Certificates, Resume (2+ years industry experience),
 * 2 Referee Letters, Work Samples/Portfolio, USI VET Transcript, Visa Copy
 * (docs v5.1 §2 Module 3 Step 4).
 */

const EVIDENCE_ITEMS: Array<{
  id: string
  label: string
  type: string
  required: boolean
  accept: string
  desc: string
}> = [
  {
    id: "academic-certificates",
    label: "Academic Certificates",
    type: "Academic Certificate",
    required: true,
    accept: ".pdf,.jpg,.jpeg,.png",
    desc: "Previous qualifications and transcripts.",
  },
  {
    id: "resume",
    label: "Resume / CV",
    type: "Resume",
    required: true,
    accept: ".pdf,.doc,.docx",
    desc: "Showing 2+ years of industry experience.",
  },
  {
    id: "referee-letters",
    label: "Referee Letters",
    type: "Referee Letter",
    required: true,
    accept: ".pdf,.jpg,.jpeg,.png",
    desc: "2 referee letters, or 1 letter signed by 2 referees.",
  },
  {
    id: "work-samples",
    label: "Work Samples / Portfolio",
    type: "Work Sample",
    required: true,
    accept: ".pdf,.jpg,.jpeg,.png,.mp4,.mov",
    desc: "Work photos and videos for trade courses.",
  },
  {
    id: "usi-vet-transcript",
    label: "USI VET Transcript",
    type: "USI Transcript",
    required: false,
    accept: ".pdf",
    desc: "Your national VET training record.",
  },
  {
    id: "visa-copy",
    label: "Visa Copy",
    type: "Visa",
    required: false,
    accept: ".pdf,.jpg,.jpeg,.png",
    desc: "Exempt for Australian Citizens and offshore applicants.",
  },
]

function StatusPill({ status }: { status: string }) {
  const variants: Record<string, string> = {
    Requested: "bg-border text-muted-foreground",
    "Not Received": "bg-amber-100 text-amber-700 border border-amber-200",
    Received: "bg-blue-100 text-blue-700 border border-blue-200",
    "Under Review": "bg-blue-100 text-blue-700 border border-blue-200",
    Approved: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    Rejected: "bg-rose-100 text-rose-700 border border-rose-200",
    Superseded: "bg-slate-100 text-slate-700 border border-slate-200",
  }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border", variants[status] || variants.Requested)}>
      {status}
    </span>
  )
}

export default function EvidencePage() {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<Record<string, { status: string; receivedAt?: string; reviewedAt?: string; rejectionReason?: string; url?: string }>>({})
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await api.get<{ items: any[] }>(`/documents?clientId=${user?.id}`)
        const byId: Record<string, any> = {}
        for (const d of data.items ?? []) {
          byId[d.type] = {
            status: d.status,
            receivedAt: d.receivedAt,
            reviewedAt: d.reviewedAt,
            rejectionReason: d.rejectionReason,
            url: d.storageKey,
          }
        }
        if (!cancelled) setDocuments(byId)
      } catch {
        // Ignore — documents may not exist yet.
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const onUpload = useCallback(
    async (item: typeof EVIDENCE_ITEMS[number], e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setUploading(item.id)
      setError(null)
      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("clientId", user?.id ?? "")
        formData.append("orderId", "")
        formData.append("type", item.type)
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
          [item.id]: { status: "Received", url: data.storageKey, receivedAt: new Date().toISOString() },
        }))
        setSuccess(`${item.label} uploaded.`)
      } catch {
        setError("Upload failed. Try again.")
      } finally {
        setUploading(null)
      }
    },
    [user?.id],
  )

  const pendingRequired = EVIDENCE_ITEMS.filter((i) => i.required && !documents[i.id]).length
  const totalRequired = EVIDENCE_ITEMS.filter((i) => i.required).length
  const uploadedRequired = totalRequired - pendingRequired

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Evidence Upload</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload your RPL evidence documents. Required items must be complete before RECEIVED status.
          </p>
        </div>
        <Badge
          variant={pendingRequired === 0 ? "default" : "secondary"}
          className={cn(
            "text-xs font-semibold px-3 py-1.5 rounded-full",
            pendingRequired === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
          )}
        >
          {uploadedRequired} / {totalRequired} required complete
        </Badge>
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

      <div className="space-y-3">
        {EVIDENCE_ITEMS.map((item) => {
          const current = documents[item.id]
          const hasFile = !!current
          return (
            <Card key={item.id} className="border-l-2 border-border">
              <CardHeader className="px-3 py-2 flex flex-row items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4" aria-hidden />
                  <CardTitle className="text-sm leading-none">{item.label}</CardTitle>
                </div>
                {item.required && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    Required
                  </span>
                )}
              </CardHeader>
              <CardContent className="px-3 py-2">
                <p className="text-[11px] text-muted-foreground mb-3">{item.desc}</p>
                {hasFile ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden />
                        <span className="text-sm">Uploaded</span>
                      </div>
                      <StatusPill status={current.status} />
                    </div>
                    {current.reviewedAt && (
                      <p className="text-[10px] text-muted-foreground">
                        Reviewed {new Date(current.reviewedAt).toLocaleDateString()}
                      </p>
                    )}
                    {current.rejectionReason && (
                      <p className="text-[10px] text-rose-600">
                        Rejection reason: {current.rejectionReason}
                      </p>
                    )}
                  </div>
                ) : (
                  <label className="block cursor-pointer">
                    <Input
                      type="file"
                      accept={item.accept}
                      onChange={(e) => onUpload(item, e)}
                      className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Upload {item.label.toLowerCase()}
                    </p>
                  </label>
                )}
              </CardContent>
              {uploading === item.id && (
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

      <Separator />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Document Status</CardTitle>
          <CardDescription className="text-xs">What each status means.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Received
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Approved
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Rejected
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Under Review
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-border" /> Not Received
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
