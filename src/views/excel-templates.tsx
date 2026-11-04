"use client"
import { useEffect, useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import {
  createExcelTemplate,
  deleteExcelTemplate,
  listExcelTemplates,
} from "@/lib/ops-store"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

export function ExcelTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [scope, setScope] = useState("clients")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const data = await listExcelTemplates()
      setTemplates(data)
    })()
  }, [])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await createExcelTemplate({
        name: name.trim(),
        scope: scope as any,
        columnMappings: [],
        status: "active",
      })
      setName("")
      const data = await listExcelTemplates()
      setTemplates(data)
    } catch (err: any) {
      alert(err.message || "Failed to create template")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this template?")) return
    try {
      await deleteExcelTemplate(id)
      const data = await listExcelTemplates()
      setTemplates(data)
    } catch (err: any) {
      alert(err.message || "Failed to delete template")
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Import Templates
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Reusable Excel column mappings for bulk imports.
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 mb-6">
        <h2 className="pb-3 text-sm font-semibold">Create Template</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Client Import"
                className={inputCls}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as any)}
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
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Creating…" : "Create Template"}
              </Button>
            </div>
          </div>
        </form>
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
                onClick={() => handleDelete(t.id)}
              >
                Delete
              </Button>
            ),
          },
        ]}
      />
    </div>
  )
}
