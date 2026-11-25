"use client"
import { useCallback, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { ToastItem, useToast } from "@/components/toast"

export function ExcelBulkRtosPage() {
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{
    rtosCreated: number
    qualificationsCreated: number
    routesCreated: number
    mappingsCreated: number
    skipped: number
    errors: Array<{ row: number; message: string }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toasts, addToast, dismissToast } = useToast()

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setError(null)
      setResult(null)
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch("/api/excel/bulk-rtos", {
          method: "POST",
          body: formData,
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data?.error?.message ?? "Bulk RTO import failed.")
        } else {
          setResult(data)
          addToast({
            title: "RTO bulk import complete",
            description: `${data.rtosCreated} RTOs, ${data.qualificationsCreated} qualifications, ${data.routesCreated} routes, ${data.mappingsCreated} mappings created. ${data.skipped} skipped.`,
            variant: "success",
          })
        }
      } catch (err: any) {
        setError(err?.message ?? "Bulk RTO import failed.")
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    },
    [addToast],
  )

  if (uploading) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <span className="relative flex h-8 w-8">
              <span className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></span>
            </span>
            <p className="text-sm text-muted-foreground">Importing RTO Directory…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Bulk RTO Import
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Import RTOs, qualifications, supplier routes, and qualification↔RTO
            mappings from the "RTO Directory" sheet of the RTO & Onboarding
            Master Hub Excel file.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 mb-4" role="alert">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!result ? (
        <div className="rounded-xl border p-8 text-center">
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="w-auto"
            disabled={uploading}
          >
            Upload RTO & Onboarding Master Hub (.xlsx)
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={onFileChange}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            Upload the "RTO & Onboarding Master Hub.xlsx" workbook. Only the
            "RTO Directory" sheet is parsed. RTOs are deduplicated by RTO code.
            Qualifications are created from the Qualification Code/Title columns.
            Supplier routes and qualification↔RTO mappings are created per row.
          </p>
          <div className="mt-6 p-4 rounded-lg bg-muted text-xs text-muted-foreground">
            <p className="font-semibold mb-2">Prerequisites:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>At least one active "certificate_source" agent (for supplier routes)</li>
              <li>Column headers expected in row 7 of the "RTO Directory" sheet</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="bg-muted p-4">
            <h2 className="text-sm font-semibold">Import Results</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 p-4">
            <div className="p-4 rounded-xl border bg-success/10 border-success/20">
              <div className="text-xs font-semibold text-success uppercase tracking-wider mb-1">
                RTOs Created
              </div>
              <div className="text-2xl font-bold text-success">{result.rtosCreated}</div>
            </div>
            <div className="p-4 rounded-xl border bg-success/10 border-success/20">
              <div className="text-xs font-semibold text-success uppercase tracking-wider mb-1">
                Qualifications Created
              </div>
              <div className="text-2xl font-bold text-success">{result.qualificationsCreated}</div>
            </div>
            <div className="p-4 rounded-xl border bg-blue/10 border-blue/20">
              <div className="text-xs font-semibold text-blue uppercase tracking-wider mb-1">
                Supplier Routes Created
              </div>
              <div className="text-2xl font-bold text-blue">{result.routesCreated}</div>
            </div>
            <div className="p-4 rounded-xl border bg-blue/10 border-blue/20">
              <div className="text-xs font-semibold text-blue uppercase tracking-wider mb-1">
                Qual↔RTO Mappings Created
              </div>
              <div className="text-2xl font-bold text-blue">{result.mappingsCreated}</div>
            </div>
            <div className="p-4 rounded-xl border bg-warning/10 border-warning/20">
              <div className="text-xs font-semibold text-warning uppercase tracking-wider mb-1">
                Skipped
              </div>
              <div className="text-2xl font-bold text-warning">{result.skipped}</div>
            </div>
            <div className="p-4 rounded-xl border bg-muted">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Errors
              </div>
              <div className="text-2xl font-bold">{result.errors.length}</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="p-4">
              <h3 className="text-xs font-semibold text-destructive mb-2">
                Errors ({result.errors.length})
              </h3>
              <ul className="text-xs text-destructive list-disc list-inside space-y-1 max-h-60 overflow-y-auto">
                {result.errors.map((e) => (
                  <li key={`${e.row}-${e.message}`}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-4 flex justify-end gap-2">
            <Button
              onClick={() => {
                setResult(null)
                setError(null)
                if (fileInputRef.current) fileInputRef.current.value = ""
              }}
            >
              Import Another
            </Button>
          </div>
        </div>
      )}

      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full max-w-xs">
            <ToastItem toast={t} onDismiss={() => dismissToast(t.id)} />
          </div>
        ))}
      </div>
    </div>
  )
}
