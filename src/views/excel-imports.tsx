"use client"
import { useEffect, useState } from "react"

import { DataTable } from "@/components/data-table"
import { listExcelImports } from "@/lib/ops-store"

export function ExcelImportsPage() {
  const [imports, setImports] = useState<any[]>([])
  const [statusFilter, setStatusFilter] = useState("")

  useEffect(() => {
    void (async () => {
      const data = await listExcelImports({ status: statusFilter || undefined })
      setImports(data)
    })()
  }, [statusFilter])

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Import History
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            View and review past Excel import jobs.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="rolledback">Rolled Back</option>
        </select>
      </div>

      <DataTable
        rows={imports}
        emptyMessage="No imports"
        rowLabel={(r: any) => r.filename || r.id}
        columns={[
          { key: "filename", label: "File" },
          {
            key: "templateId",
            label: "Template",
            render: (r: any) => r.templateId || "—",
          },
          {
            key: "status",
            label: "Status",
            render: (r: any) => r.status,
          },
          {
            key: "rowCounts",
            label: "Rows",
            render: (r: any) => {
              const rc = r.rowCounts || {}
              return `${rc.success}/${rc.total} (${rc.failed} failed)`
            },
          },
          { key: "startedAt", label: "Started", render: (r: any) => r.startedAt },
        ]}
      />
    </div>
  )
}
