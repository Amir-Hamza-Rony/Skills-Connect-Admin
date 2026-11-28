"use client"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createEnrolmentKit,
  deleteEnrolmentKit,
  listEnrolmentKits,
  updateEnrolmentKit,
} from "@/lib/store"
import type { EnrolmentKit } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

export function EnrolmentKitsPage() {
  const [rows, setRows] = useState<EnrolmentKit[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<EnrolmentKit | null>(null)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<string>("")

  const [qualId, setQualId] = useState("")
  const [rtoId, setRtoId] = useState("")
  const [fileName, setFileName] = useState("")
  const [fileUrl, setFileUrl] = useState("")
  const [contentType, setContentType] = useState("application/pdf")
  const [sizeBytes, setSizeBytes] = useState("")
  const [active, setActive] = useState(true)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listEnrolmentKits()))()
  }, [])

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((k) => {
      if (search && !k.fileName.toLowerCase().includes(search.toLowerCase())) return false
      if (activeFilter !== "" && k.active !== (activeFilter === "true")) return false
      return true
    })
  }, [rows, search, activeFilter])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!qualId.trim() || !rtoId.trim() || !fileName.trim() || !fileUrl.trim()) {
      setError("All fields are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createEnrolmentKit({
        qualificationId: qualId.trim(),
        issuingRtoId: rtoId.trim(),
        fileName: fileName.trim(),
        fileUrl: fileUrl.trim(),
        contentType,
        sizeBytes: sizeBytes ? Number(sizeBytes) : 0,
        active,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setQualId("")
      setRtoId("")
      setFileName("")
      setFileUrl("")
      setContentType("application/pdf")
      setSizeBytes("")
      setActive(true)
    } catch (err: any) {
      setError(err?.message ?? "Failed to create enrolment kit.")
    } finally {
      setSaving(false)
    }
  }

  async function onUpdate(e: FormEvent, k: EnrolmentKit) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const updated = await updateEnrolmentKit(k.id, {
        fileName: fileName.trim() || k.fileName,
        fileUrl: fileUrl.trim() || k.fileUrl,
        contentType,
        sizeBytes: sizeBytes ? Number(sizeBytes) : k.sizeBytes,
        active,
        qualificationId: qualId.trim() || k.qualificationId,
        issuingRtoId: rtoId.trim() || k.issuingRtoId,
      })
      setRows((prev) =>
        prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null,
      )
      setEditing(null)
    } catch (err: any) {
      setError(err?.message ?? "Failed to update enrolment kit.")
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this enrolment kit?")) return
    setSaving(true)
    try {
      await deleteEnrolmentKit(id)
      setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev))
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete enrolment kit.")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading enrolment kits" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Enrolment Kits
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            RTO-specific enrolment kits (PDF/DOCX) per qualification → RTO pair
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Phase 4</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add kit
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-full md:w-64">
          <input
            type="search"
            placeholder="Search file name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          className={inputCls}
        >
          <option value="">All</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      <DataTable<EnrolmentKit>
        rows={visible}
        emptyMessage="No enrolment kits match the current filters."
        columns={[
          {
            key: "fileName",
            label: "File Name",
            render: (k) => <span className="font-medium">{k.fileName}</span>,
          },
          {
            key: "qualificationId",
            label: "Qualification",
            render: (k) => <span className="text-muted-foreground">{k.qualificationId}</span>,
          },
          {
            key: "issuingRtoId",
            label: "Issuing RTO",
            render: (k) => <span className="text-muted-foreground">{k.issuingRtoId}</span>,
          },
          {
            key: "contentType",
            label: "Type",
            render: (k) => <Badge variant="secondary">{k.contentType}</Badge>,
          },
          {
            key: "size",
            label: "Size",
            render: (k) => `${(k.sizeBytes / 1024).toFixed(1)} KB`,
          },
          {
            key: "active",
            label: "Active",
            render: (k) => (
              <Badge variant={k.active ? "success" : "secondary"}>
                {k.active ? "Yes" : "No"}
              </Badge>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (k) => (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQualId(k.qualificationId)
                    setRtoId(k.issuingRtoId)
                    setFileName(k.fileName)
                    setFileUrl(k.fileUrl)
                    setContentType(k.contentType)
                    setSizeBytes(String(k.sizeBytes))
                    setActive(k.active)
                    setEditing(k)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onDelete(k.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add enrolment kit"
        description="Upload a PDF/DOCX enrolment kit for a qualification→RTO pair."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kit-qual">Qualification ID</Label>
              <Input
                id="kit-qual"
                value={qualId}
                onChange={(e) => setQualId(e.target.value)}
                placeholder="e.g. 64f…"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kit-rto">Issuing RTO ID</Label>
              <Input
                id="kit-rto"
                value={rtoId}
                onChange={(e) => setRtoId(e.target.value)}
                placeholder="e.g. 64f…"
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kit-file">File Name</Label>
            <Input
              id="kit-file"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="enrolment_kit_chc33021.pdf"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kit-url">File URL</Label>
            <Input
              id="kit-url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://…/kit.pdf"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kit-type">Content Type</Label>
              <Input
                id="kit-type"
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                placeholder="application/pdf"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kit-size">Size (bytes)</Label>
              <Input
                id="kit-size"
                type="number"
                value={sizeBytes}
                onChange={(e) => setSizeBytes(e.target.value)}
                placeholder="102400"
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kit-active">Active</Label>
            <select
              id="kit-active"
              value={active ? "true" : "false"}
              onChange={(e) => setActive(e.target.value === "true")}
              className={inputCls}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add kit"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit enrolment kit"
        description={editing ? `File: ${editing.fileName}` : undefined}
      >
        <form onSubmit={(e) => onUpdate(e, editing!)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ek-qual">Qualification ID</Label>
              <Input
                id="ek-qual"
                value={qualId}
                onChange={(e) => setQualId(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ek-rto">Issuing RTO ID</Label>
              <Input
                id="ek-rto"
                value={rtoId}
                onChange={(e) => setRtoId(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ek-file">File Name</Label>
            <Input
              id="ek-file"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ek-url">File URL</Label>
            <Input
              id="ek-url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ek-type">Content Type</Label>
              <Input
                id="ek-type"
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ek-size">Size (bytes)</Label>
              <Input
                id="ek-size"
                type="number"
                value={sizeBytes}
                onChange={(e) => setSizeBytes(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ek-active">Active</Label>
            <select
              id="ek-active"
              value={active ? "true" : "false"}
              onChange={(e) => setActive(e.target.value === "true")}
              className={inputCls}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save kit"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
