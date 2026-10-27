import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { DocumentStatusBadge } from "@/components/status-badge"
import { useAuth } from "@/lib/auth"
import { hasPermission } from "@/lib/permissions"
import {
  checklistFor,
  downloadDocument,
  listClients,
  listDocuments,
  listOrders,
  uploadDocument,
  reviewDocument,
} from "@/lib/ops-store"
import { listQualifications, listUserDirectory, qualificationLabel } from "@/lib/store"
import type {
  Client,
  Order,
  OrderDocument,
  Qualification,
  UserRef,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

type Queue = "Missing" | "Under Review" | "Rejected" | "Received" | "Approved" | "All"

const QUEUES: Queue[] = ["Missing", "Under Review", "Rejected", "Received", "Approved", "All"]

function inQueue(d: OrderDocument, q: Queue): boolean {
  switch (q) {
    case "All":
      return true
    case "Missing":
      return d.status === "Requested" || d.status === "Not Received"
    case "Under Review":
      return d.status === "Under Review" || d.status === "Received"
    case "Rejected":
      return d.status === "Rejected"
    case "Received":
      return d.status === "Received"
    case "Approved":
      return d.status === "Approved" || d.status === "Superseded"
  }
}

/**
 * Documents workspace: cross-order queues (Missing / Under Review /
 * Rejected / …), approve/reject with reason, and new versions that
 * supersede instead of overwriting. File bytes are stored directly in
 * MongoDB — there is no S3 bucket, no object storage, and no presigned
 * URLs. Uploading is a single form-data POST; downloading streams bytes
 * back from the API.
 */
export function DocumentsPage() {
  const { user, permissions } = useAuth()
  const canReview = hasPermission(permissions, "documents.review")

  const [orders, setOrders] = useState<Order[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [quals, setQuals] = useState<Qualification[]>([])
  const [users, setUsers] = useState<UserRef[]>([])
  const [docs, setDocs] = useState<OrderDocument[] | null>(null)
  const [queue, setQueue] = useState<Queue>("Missing")

  const [reviewing, setReviewing] = useState<OrderDocument | null>(null)
  const [verdict, setVerdict] = useState<"Approved" | "Rejected">("Approved")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [orderFilter, setOrderFilter] = useState("")

  // Upload form state
  const [uploading, setUploading] = useState<OrderDocument | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      const [o, c, q, u] = await Promise.all([
        listOrders(),
        listClients(),
        listQualifications(),
        listUserDirectory(),
      ])
      setOrders(o)
      setClients(c)
      setQuals(q)
      setUsers(u)
      const all = (await Promise.all(o.map((ord) => listDocuments(ord.id)))).flat()
      setDocs(all)
    })()
  }, [])

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const qualById = useMemo(() => new Map(quals.map((q) => [q.id, q])), [quals])
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  const visible = useMemo(
    () =>
      (docs ?? []).filter(
        (d) => inQueue(d, queue) && (!orderFilter || d.orderId === orderFilter),
      ),
    [docs, queue, orderFilter],
  )

  const counts = useMemo(() => {
    const m = new Map<Queue, number>()
    for (const q of QUEUES) m.set(q, (docs ?? []).filter((d) => inQueue(d, q)).length)
    return m
  }, [docs])

  async function onReview(e: FormEvent) {
    e.preventDefault()
    if (!reviewing) return
    setFormError(null)
    if (verdict === "Rejected" && !reason.trim()) {
      setFormError("A rejection reason is required.")
      return
    }
    setSaving(true)
    try {
      const updated = await reviewDocument(
        reviewing.id,
        verdict,
        user?.id ?? "preview-user",
        reason.trim() || undefined,
      )
      setDocs((prev) => prev?.map((d) => (d.id === updated.id ? updated : d)) ?? null)
      setReviewing(null)
      setReason("")
      setVerdict("Approved")
    } finally {
      setSaving(false)
    }
  }

  /** Downloads the stored file bytes and opens them in the browser. */
  async function onDownload(d: OrderDocument) {
    setFormError(null)
    try {
      setSaving(true)
      const blob = await downloadDocument(d.id)
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener")
      // Revoke the object URL after a short delay so the browser can consume it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not download the file.")
    } finally {
      setSaving(false)
    }
  }

  /** Handles picking a file for a new version of a document type. */
  function onFileSelected(d: OrderDocument, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    setUploading(d)
  }

  /** Submits the selected file as a new document version. */
  async function onSubmitUpload() {
    if (!uploading || !uploadFile) return
    setFormError(null)
    setSaving(true)
    try {
      const { document } = await uploadDocument(uploading.orderId, uploadFile, uploading.type)
      setDocs((prev) => (prev ? [document, ...prev] : [document]))
      setUploadFile(null)
      setUploading(null)
      fileInputRef.current!.value = ""
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not upload the file.")
    } finally {
      setSaving(false)
    }
  }

  if (!docs) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading documents" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Documents</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Evidence workspace · {docs.length} tracked files
          </p>
        </div>
        <Badge variant="success">Live data</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pb-3">
        {QUEUES.map((q) => (
          <button
            key={q}
            onClick={() => setQueue(q)}
            aria-pressed={queue === q}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              queue === q
                ? "border-primary/50 bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}>
            {q} <span className="text-xs tabular-nums">({counts.get(q) ?? 0})</span>
          </button>
        ))}
        <select
          aria-label="Filter by order"
          value={orderFilter}
          onChange={(e) => setOrderFilter(e.target.value)}
          className={`${inputCls} w-auto`}
        >
          <option value="">All orders</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {clientById.get(o.clientId)?.legalName ?? o.id} ·{" "}
              {qualById.get(o.qualificationId)?.code ?? ""}
            </option>
          ))}
        </select>
      </div>

      {formError && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {formError}
        </p>
      )}

      <DataTable<OrderDocument>
        rows={visible}
        emptyMessage={`Nothing in the ${queue} queue.`}
        rowLabel={(d) => `${d.type} v${d.version}`}
        columns={[
          {
            key: "doc",
            label: "Document",
            render: (d) => (
              <span>
                <span className="font-medium">{d.type}</span>
                <span className="block text-xs text-muted-foreground">
                  v{d.version} · {clientById.get(d.clientId)?.legalName ?? d.clientId}
                  {` · ${d.fileName} (${Math.round(d.sizeBytes / 1024)} KB)`}
                  {" · "}
                  <Link to={`/orders/${d.orderId}`} className="text-primary underline-offset-4 hover:underline">
                    {orderById.get(d.orderId) && qualById.get(orderById.get(d.orderId)!.qualificationId)
                      ? qualificationLabel(qualById.get(orderById.get(d.orderId)!.qualificationId)!)
                      : d.orderId}
                  </Link>
                </span>
              </span>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (d) => <DocumentStatusBadge status={d.status} />,
          },
          {
            key: "review",
            label: "Review",
            render: (d) => (
              <span className="text-xs text-muted-foreground">
                {d.reviewedBy ? `${userById.get(d.reviewedBy)?.name ?? d.reviewedBy}` : "—"}
                {d.rejectionReason ? ` · ${d.rejectionReason}` : ""}
              </span>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (d) => {
              const isBeingUploaded = uploading?.id === d.id
              return (
                <span className="flex flex-wrap gap-1.5">
                  {canReview && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReviewing(d)
                        setVerdict("Approved")
                        setReason("")
                      }}
                    >
                      Review
                    </Button>
                  )}
                  {d.status === "Not Received" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Confirm the uploaded file landed"
                      disabled
                    >
                      Confirm
                    </Button>
                  )}
                  {d.status !== "Not Received" && d.status !== "Requested" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Download the stored file from the API"
                      onClick={() => void onDownload(d)}
                    >
                      Download
                    </Button>
                  )}
                  {isBeingUploaded ? (
                    <Button size="sm" variant="outline" disabled onClick={onSubmitUpload}>
                      Uploading…
                    </Button>
                  ) : (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="sr-only"
                        onChange={(e) => void onFileSelected(d, e)}
                        accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.docx,.xlsx,.csv,.txt"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => fileInputRef.current?.click()}
                        title={`Upload a new version of ${d.type} (v${d.version})`}
                      >
                        + Version
                      </Button>
                      {uploadFile && uploadFile.name && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={onSubmitUpload}
                          disabled={saving}
                        >
                          Upload {uploadFile.name}
                        </Button>
                      )}
                    </>
                  )}
                </span>
              )
            },
          },
        ]}
      />

      <p className="pt-3 text-xs text-muted-foreground">
        Checklist per qualification: {checklistFor("").length} standard types. File bytes are stored
        directly in MongoDB — no S3 bucket, no object storage, no presigned URLs.
      </p>

      <Dialog
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        title={reviewing ? `Review — ${reviewing.type} (v${reviewing.version})` : "Review document"}
        description="Approvals and rejections record reviewer, timestamp, and reason."
      >
        <form onSubmit={onReview} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="doc-verdict" className="text-sm font-medium">Verdict</label>
            <select id="doc-verdict" value={verdict} onChange={(e) => setVerdict(e.target.value as "Approved" | "Rejected")} className={inputCls}>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
          {verdict === "Rejected" && (
            <div className="space-y-1.5">
              <label htmlFor="doc-reason" className="text-sm font-medium">Rejection reason</label>
              <input id="doc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What the client must fix…" className={inputCls} />
            </div>
          )}
          {formError && (
            <p role="alert" className="text-sm text-destructive">{formError}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save review"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
