"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, FileText, AlertCircle, CheckCircle2, Clock } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

/**
 * Certificate Download (/applicant/certificate).
 *
 * Certificate is immediately available for download in /applicant and /partner
 * when status is DELIVERED (docs v5.1 §2 Module 3 Step D).
 *
 * B2B Candidate Isolation: ALL pricing, fees, and invoice tabs are completely
 * hidden when channel_type == EXTERNAL_BROKER (docs v5.1 §1, v5.0 §2).
 */

function StatusPill({ status }: { status: string }) {
  const variants: Record<string, string> = {
    "Not Issued": "bg-border text-muted-foreground",
    Pending: "bg-amber-100 text-amber-700 border border-amber-200",
    Issued: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    "Certificate File Received": "bg-blue-100 text-blue-700 border border-blue-200",
    "Delivered to Client": "bg-emerald-100 text-emerald-700 border border-emerald-200",
  }
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border",
      variants[status] || variants["Not Issued"],
    )}>
      {status}
    </span>
  )
}

export default function CertificatePage() {
  const { user } = useAuth()
  const [certificate, setCertificate] = useState<{
    status: string
    certificateNumber?: string
    issueDate?: string
    storageKey?: string
    deliveredAt?: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const channelB2B = user?.channelType === "EXTERNAL_BROKER"

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setLoading(true)
        const data = await api.get<{ items: any[] }>(`/certificates?clientId=${user?.id}`)
        const cert = (data.items ?? [])[0] ?? null
        if (!cancelled) setCertificate(cert)
      } catch {
        if (!cancelled) setError("Unable to load certificate.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const onDownload = useCallback(async () => {
    if (!certificate?.storageKey) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/certificates/${certificate.storageKey}/download`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("sc-access-token") ?? ""}` },
      })
      if (!res.ok) throw new Error("Download failed.")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = certificate.certificateNumber ?? "certificate.pdf"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setError("Download failed. Try again.")
    } finally {
      setDownloading(false)
    }
  }, [certificate])

  const canDownload = certificate?.status === "Issued" || certificate?.status === "Certificate File Received" || certificate?.status === "Delivered to Client"

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="animate-pulse rounded-full h-8 w-8 bg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Certificate</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Download your issued certificate when available.
          </p>
        </div>
        {certificate && (
          <StatusPill status={certificate.status} />
        )}
      </div>

      {channelB2B && (
        <div className="rounded-md border border-amber-100 bg-amber-50 p-4 text-amber-800 text-sm">
          <Clock className="h-4 w-4 mr-2" aria-hidden />
          Your broker manages invoicing and pricing. All fee and invoice details
          are handled through your broker portal.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Your Certificate</CardTitle>
          <CardDescription className="text-xs">Issued qualification certificate.</CardDescription>
        </CardHeader>
        <CardContent>
          {!certificate ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" aria-hidden />
              <p className="text-sm text-muted-foreground">No certificate on file yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your certificate will appear here once your application reaches DELIVERED status.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{certificate.certificateNumber ?? "Certificate"}</span>
                  <p className="text-xs text-muted-foreground">{certificate.status}</p>
                </div>
                <StatusPill status={certificate.status} />
              </div>
              {certificate.issueDate && (
                <p className="text-xs text-muted-foreground">
                  Issued {new Date(certificate.issueDate).toLocaleDateString()}
                </p>
              )}
              {certificate.deliveredAt && (
                <p className="text-xs text-muted-foreground">
                  Delivered {new Date(certificate.deliveredAt).toLocaleDateString()}
                </p>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter>
          {canDownload && certificate?.storageKey ? (
            <Button
              onClick={onDownload}
              className="w-full"
              disabled={downloading}
            >
              {downloading ? (
                <><Download className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Downloading…</>
              ) : (
                <><Download className="mr-2 h-4 w-4" aria-hidden /> Download Certificate</>
              )}
            </Button>
          ) : (
            <Button variant="outline" className="w-full" disabled>
              Certificate not yet available for download
            </Button>
          )}
        </CardFooter>
      </Card>

      <Separator />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How certificate delivery works</CardTitle>
          <CardDescription className="text-xs">Application pipeline status flow.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-slate-500" /> DRAFT — Lead created, awaiting Level 2 completion.
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> RECEIVED — ID verified, invoice generated, price snapshots locked.
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> IN_PROGRESS — Payment confirmed, lodged with Issuing RTO.
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> DELIVERED — Certificate uploaded, download unlocked, commission eligible.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
