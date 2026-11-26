"use client"

import { useCallback, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { ToastItem, useToast } from "@/components/toast"

export default function ImportMasterHubPage() {
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<any | null>(null)
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
        const res = await fetch("/api/excel/import-master-hub", {
          method: "POST",
          body: formData,
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data?.error?.message ?? "Master Hub import failed.")
        } else {
          setResult(data)
          addToast({
            title: "Master Hub import complete",
            description: `${data.rtosCreated} RTOs, ${data.qualificationsCreated} qualifications, ${data.agentsCreated} agents, ${data.routesCreated} routes, ${data.mappingsCreated} mappings created. ${data.skipped} skipped.`,
            variant: "success",
          })
        }
      } catch (err: any) {
        setError(err?.message ?? "Master Hub import failed.")
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
            <p className="text-sm text-muted-foreground">Importing Master Hub…</p>
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
            Import Master Hub
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload the full RTO &amp; Onboarding Master Hub Excel file. All
            values are automatically distributed into their respective
            modules — RTOs, qualifications, agents, supplier routes, and
            qualification↔RTO mappings. Manual entry remains available via
            the Agents, Qualifications, RTOs and Pricing pages.
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
            Upload Master Hub (.xlsx)
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={onFileChange}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            Upload the "RTO &amp; Onboarding Master Hub.xlsx" workbook. Every
            recognised sheet is parsed: "RTO Directory", "RTO Price Matrix",
            "Course Master", and any "Agents" sheet. Data is written inside a
            single transaction — either everything imports or nothing does.
          </p>
          <div className="mt-6 p-4 rounded-lg bg-muted text-xs text-muted-foreground">
            <p className="font-semibold mb-2">Sheets processed:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>RTO Directory</strong> → RTOs, qualifications,
                qualification↔RTO mappings, supplier routes (wholesale costs)
              </li>
              <li>
                <strong>RTO Price Matrix</strong> → supplier route wholesale
                costs
              </li>
              <li><strong>Course Master</strong> → qualifications</li>
              <li><strong>Agents</strong> → agents (demo contact auto-filled if missing)</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="bg-muted p-4">
            <h2 className="text-sm font-semibold">Import Results</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-4 p-4">
            <StatCard
              title="RTOs Created"
              value={result.rtosCreated}
              variant="success"
            />
            <StatCard
              title="Qualifications Created"
              value={result.qualificationsCreated}
              variant="success"
            />
            <StatCard
              title="Agents Created"
              value={result.agentsCreated}
              variant="blue"
            />
            <StatCard
              title="Supplier Routes Created"
              value={result.routesCreated}
              variant="blue"
            />
            <StatCard
              title="Qual↔RTO Mappings"
              value={result.mappingsCreated}
              variant="blue"
            />
            <StatCard
              title="Skipped"
              value={result.skipped}
              variant="warning"
            />
            <StatCard
              title="Errors"
              value={result.errors?.length ?? 0}
              variant="destructive"
            />
          </div>

          {result.errors && result.errors.length > 0 && (
            <div className="p-4">
              <h3 className="text-xs font-semibold text-destructive mb-2">
                Errors ({result.errors.length})
              </h3>
              <ul className="text-xs text-destructive list-disc list-inside space-y-1 max-h-60 overflow-y-auto">
                {result.errors.map((e: any, i: number) => (
                  <li key={i}>
                    {e.sheet ? `[${e.sheet}] ` : ""}Row {e.row}: {e.message}
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

function StatCard({ title, value, variant = "default" }: { title: string; value: number; variant?: "default" | "success" | "blue" | "warning" | "destructive" }) {
  const variants: Record<string, string> = {
    default: "border-muted bg-muted",
    success: "border-success/10 bg-success/10",
    blue: "border-blue/10 bg-blue/10",
    warning: "border-warning/10 bg-warning/10",
    destructive: "border-destructive/10 bg-destructive/10",
  }
  const colorMap: Record<string, string> = {
    default: "text-muted-foreground",
    success: "text-success",
    blue: "text-blue",
    warning: "text-warning",
    destructive: "text-destructive",
  }
  return (
    <div className={`p-4 rounded-xl border ${variants[variant]}`}>
      <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${colorMap[variant]}`}>
        {title}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}
