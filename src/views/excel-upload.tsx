"use client"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import {
  createExcelTemplate,
  deleteExcelTemplate,
  executeExcelImport,
  listExcelTemplates,
  uploadExcelFile,
} from "@/lib/ops-store"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

export function ExcelUploadPage() {
  const [templates, setTemplates] = useState<any[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [templateName, setTemplateName] = useState("")
  const [templateScope, setTemplateScope] = useState("clients")
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      const data = await listExcelTemplates()
      setTemplates(data)
    })()
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreview(null)
    setSelectedTemplate(null)
    setUploading(true)
    try {
      const p = await uploadExcelFile(f)
      setPreview(p)
    } catch (err: any) {
      alert(err.message || "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const handleImport = async () => {
    if (!preview || !selectedTemplate) return
    setImporting(true)
    try {
      const rows = preview.rows.map((r: any, i: number) => ({
        rowNumber: r.rowNumber ?? i + 2,
        sourceData: r,
      }))
      await executeExcelImport(selectedTemplate, rows)
      alert("Import completed")
      setPreview(null)
      setFile(null)
      setSelectedTemplate(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err: any) {
      alert(err.message || "Import failed")
    } finally {
      setImporting(false)
    }
  }

  const handleTemplateCreate = async () => {
    if (!templateName.trim()) return
    setSaving(true)
    try {
      await createExcelTemplate({
        name: templateName.trim(),
        scope: templateScope as any,
        columnMappings: [],
        status: "active",
      })
      setTemplateName("")
      const data = await listExcelTemplates()
      setTemplates(data)
      setMappingOpen(false)
      alert("Template created")
    } catch (err: any) {
      alert(err.message || "Failed to create template")
    } finally {
      setSaving(false)
    }
  }

  const handleTemplateDelete = async (id: string) => {
    if (!window.confirm("Delete this template?")) return
    try {
      await deleteExcelTemplate(id)
      const data = await listExcelTemplates()
      setTemplates(data)
      alert("Template deleted")
    } catch (err: any) {
      alert(err.message || "Failed to delete template")
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Excel Import
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload .xlsx/.xls files, preview rows, map columns, and import into
            the system.
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 mb-6">
        <h2 className="pb-3 text-sm font-semibold">1. Upload Excel File</h2>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative w-full md:w-96">
            <input
              id="excel-file"
              type="file"
              accept=".xlsx,.xls"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="sr-only"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center rounded-lg border border-dashed border-input px-8 py-6 hover:bg-accent/50"
            >
              {file ? (
                <>
                  <span className="text-sm font-medium">{file.name}</span>
                  <p className="text-xs text-muted-foreground">
                    Click to change file
                  </p>
                </>
              ) : (
                <>
                  <span className="text-sm">Click to upload</span>
                  <p className="text-xs text-muted-foreground">
                    .xlsx or .xls (max 10 MB)
                  </p>
                </>
              )}
            </button>
          </div>
          {uploading && (
            <div className="flex h-9 items-center">
              <Button variant="outline" disabled>Uploading…</Button>
            </div>
          )}
        </div>
        {preview && (
          <div className="mt-4 p-4 rounded-lg bg-muted">
            <p className="text-xs font-medium mb-2">
              Preview: {preview.filename} ({preview.previewRowCount} of{" "}
              {preview.rowCount} rows shown)
            </p>
            <DataTable
              rows={preview.rows}
              emptyMessage="No rows to preview"
              rowLabel={(r: any) => `Row ${r.rowNumber ?? 0}`}
              columns={preview.headers.map((h: string) => ({
                key: h,
                label: h,
                render: (r: any) => String(r[h] ?? ""),
              }))}
            />
            {preview.unmappedColumns.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Unmapped columns: {preview.unmappedColumns.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>

      {preview && (
        <div className="rounded-xl border bg-card p-6">
          <h2 className="pb-3 text-sm font-semibold">2. Select Template & Import</h2>
          <div className="grid gap-3 sm:grid-cols-3 mb-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Template</label>
              <select
                value={selectedTemplate ?? ""}
                onChange={(e) => setSelectedTemplate(e.target.value || null)}
                className={inputCls}
              >
                <option value="">Select a template…</option>
                {templates.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.scope})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setMappingOpen(true)}
              variant="outline"
            >
              Manage Templates
            </Button>
            <Button
              onClick={handleImport}
              disabled={!selectedTemplate || importing}
            >
              {importing ? "Importing…" : "Import Data"}
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={mappingOpen}
        onClose={() => setMappingOpen(false)}
        title="Manage Import Templates"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Template Name</label>
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Client Import"
                className={inputCls}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Scope</label>
              <select
                value={templateScope}
                onChange={(e) => setTemplateScope(e.target.value as any)}
                className={inputCls}
              >
                <option value="clients">Clients</option>
                <option value="orders">Orders</option>
                <option value="rtos">RTOs</option>
                <option value="agents">Agents</option>
                <option value="qualifications">Qualifications</option>
              </select>
            </div>
            <div className="space-y-2 flex items-end">
              <Button
                onClick={handleTemplateCreate}
                disabled={!templateName.trim()}
              >
                Create Template
              </Button>
            </div>
          </div>
          <DataTable
            rows={templates}
            emptyMessage="No templates"
            rowLabel={(t: any) => t.name}
            columns={[
              { key: "name", label: "Name" },
              { key: "scope", label: "Scope" },
              { key: "status", label: "Status", render: (t: any) => t.status },
              {
                key: "actions",
                label: "Actions",
                render: (t: any) => (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleTemplateDelete(t.id)}
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Dialog>
    </div>
  )
}
