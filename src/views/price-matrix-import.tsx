"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/dialog"
import {
  previewPriceMatrix,
  importPriceMatrix,
  listAgents,
  listQualifications,
  listRtos,
  type PriceMatrixPreviewResult,
  type PriceMatrixImportRow,
  type PriceMatrixImportResult,
} from "@/lib/store"

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

const STATUS_VARIANT: Record<string, string> = {
  Ready: "border-success/50 bg-success/10 text-success",
  "Pending Review": "border-warning/50 bg-warning/10 text-warning",
  Conflict: "border-destructive/50 bg-destructive/10 text-destructive",
  Invalid: "border-destructive/50 bg-destructive/10 text-destructive",
  Imported: "border-muted bg-muted/50 text-muted",
}

function formatCurrency(n: number | null): string {
  if (n === null) return "—"
  return `AUD ${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`
}

interface PriceMatrixRow {
  rowNum: number
  qualificationCode: string | null
  qualificationTitle: string | null
  qualificationId: string | null
  rtoName: string | null
  rtoCode: string | null
  rtoId: string | null
  wholesaleCost: number | null
  currency: string
  status: "Ready" | "Pending Review" | "Conflict" | "Invalid" | "Imported"
  errors: string[]
}

export function PriceMatrixImportPage() {
  const [preview, setPreview] = useState<PriceMatrixPreviewResult | null>(null)
  const [importResult, setImportResult] = useState<PriceMatrixImportResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agentSelections, setAgentSelections] = useState<Record<number, string>>({})
  const [importedRowIndices, setImportedRowIndices] = useState<Set<number>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [agents, setAgents] = useState<Array<{ id: string; name: string; type: string; active: boolean }>>([])
  const [quals, setQuals] = useState<Array<{ id: string; code: string; title: string }>>([])
  const [rtos, setRtos] = useState<Array<{ id: string; rtoCode: string; tradingName: string; legalName: string }>>([])

  useEffect(() => {
    void (async () => {
      const [a, q, r] = await Promise.all([listAgents(), listQualifications(), listRtos()])
      setAgents(a)
      setQuals(q)
      setRtos(r)
    })()
  }, [])

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const sourcingAgents = useMemo(
    () => agents.filter((a) => a.type === "certificate_source" && a.active),
    [agents],
  )

  const rows = useMemo(() => preview?.preview.rows ?? [], [preview])
  const readyRows = useMemo(() => rows.filter((r: PriceMatrixRow) => r.status === "Ready"), [rows])
  const pendingRows = useMemo(() => rows.filter((r: PriceMatrixRow) => r.status === "Pending Review"), [rows])

  const canImport = readyRows.length > 0

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setError(null)
      setImportResult(null)
      setUploading(true)
      try {
        const result = await previewPriceMatrix(file)
        setPreview(result)
      } catch (err: any) {
        setError(err?.message ?? "Failed to preview the Price Matrix.")
      } finally {
        setUploading(false)
      }
    },
    [],
  )

  const onAgentChange = useCallback((rowNum: number, agentId: string | null) => {
    setAgentSelections((prev) => {
      const next = { ...prev }
      if (agentId) next[rowNum] = agentId
      else delete next[rowNum]
      return next
    })
  }, [])

  const onImport = useCallback(async () => {
    if (!preview) return
    setError(null)
    setImporting(true)
    try {
      const rowsToImport: PriceMatrixImportRow[] = readyRows.map((r) => ({
        qualificationId: r.qualificationId!,
        rtoId: r.rtoId!,
        sourceAgentId: agentSelections[r.rowNum] ?? "",
        wholesaleCost: r.wholesaleCost ?? 0,
        currency: r.currency,
        effectiveFrom: new Date().toISOString(),
        effectiveTo: null,
      }))

      const result = await importPriceMatrix(rowsToImport)
      setImportResult(result)

      const newlyImported = new Set(importedRowIndices)
      result.imported.forEach((imp) => newlyImported.add(imp.rowIndex))
      setImportedRowIndices(newlyImported)

      setPreview((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          preview: {
            ...prev.preview,
            rows: prev.preview.rows.map((row: PriceMatrixRow) => {
              if (result.imported.some((imp) => imp.rowIndex === row.rowNum)) {
                return { ...row, status: "Imported" }
              }
              return row
            }),
          },
        }
      })
    } catch (err: any) {
      setError(err?.message ?? "Import failed.")
    } finally {
      setImporting(false)
    }
  }, [preview, readyRows, agentSelections, importedRowIndices])

  const onReset = useCallback(() => {
    setPreview(null)
    setImportResult(null)
    setError(null)
    setAgentSelections({})
    setImportedRowIndices(new Set())
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [])

  const statusCounts = useMemo(() => {
    if (!preview) return { ready: 0, pending: 0, conflict: 0, invalid: 0, imported: 0 }
    const allRows = preview.preview.rows
    return {
      ready: allRows.filter((r: PriceMatrixRow) => r.status === "Ready").length,
      pending: allRows.filter((r: PriceMatrixRow) => r.status === "Pending Review").length,
      conflict: allRows.filter((r: PriceMatrixRow) => r.status === "Conflict").length,
      invalid: allRows.filter((r: PriceMatrixRow) => r.status === "Invalid").length,
      imported: allRows.filter((r: PriceMatrixRow) => r.status === "Imported").length,
    }
  }, [preview])

  if (uploading) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <span className="relative flex h-8 w-8">
              <span className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></span>
            </span>
            <p className="text-sm text-muted-foreground">Parsing Price Matrix…</p>
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
            Price Matrix Import
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Map Master Hub RTO Price Matrix rows to sourcing agents before importing supplier routes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onReset}
            disabled={!preview || uploading}
          >
            Reset
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 mb-4" role="alert">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!preview ? (
        <div className="rounded-xl border p-8 text-center">
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="w-auto"
          >
            Upload Price Matrix (.xlsx)
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
            "RTO Price Matrix" sheet is parsed. No data is written until you
            confirm the import.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 mb-6">
            <div className="p-4 rounded-xl border bg-muted">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Total combinations
              </div>
              <div className="text-2xl font-bold">{preview.preview.totalRows}</div>
            </div>
            <div className="p-4 rounded-xl border bg-success/10 border-success/20">
              <div className="text-xs font-semibold text-success uppercase tracking-wider mb-1">
                Ready to import
              </div>
              <div className="text-2xl font-bold text-success">{statusCounts.ready}</div>
            </div>
            <div className="p-4 rounded-xl border bg-warning/10 border-warning/20">
              <div className="text-xs font-semibold text-warning uppercase tracking-wider mb-1">
                Pending review
              </div>
              <div className="text-2xl font-bold text-warning">{statusCounts.pending}</div>
            </div>
            <div className="p-4 rounded-xl border bg-destructive/10 border-destructive/20">
              <div className="text-xs font-semibold text-destructive uppercase tracking-wider mb-1">
                Conflicts &amp; invalid
              </div>
              <div className="text-2xl font-bold text-destructive">
                {statusCounts.conflict + statusCounts.invalid}
              </div>
            </div>
          </div>

          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Qualification</th>
                  <th className="text-left px-4 py-2 font-medium">RTO</th>
                  <th className="text-right px-4 py-2 font-medium">Wholesale Cost</th>
                  <th className="text-left px-4 py-2 font-medium">Sourcing Agent</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-muted">
                {rows.map((row: PriceMatrixRow) => {
                  const isImported = row.status === "Imported"
                  const isReady = row.status === "Ready"
                  const selectedAgentId = agentSelections[row.rowNum]
                  const agent = selectedAgentId ? agentById.get(selectedAgentId) : null

                  return (
                    <tr key={row.rowNum} className={isImported ? "text-muted-foreground/50" : ""}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.qualificationCode ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{row.qualificationTitle ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.rtoName ?? "—"}</div>
                        {row.rtoCode && (
                          <div className="text-xs text-muted-foreground">{row.rtoCode}</div>
                        )}
                      </td>
                      <td className="text-right px-4 py-3 font-medium tabular-nums">
                        {formatCurrency(row.wholesaleCost)}
                      </td>
                      <td className="px-4 py-3">
                        {isImported ? (
                          <span className="text-xs text-muted-foreground">
                            {agent?.name ?? "—"}
                          </span>
                        ) : isReady ? (
                          <select
                            className={selectCls}
                            value={selectedAgentId ?? ""}
                            onChange={(e) => onAgentChange(row.rowNum, e.target.value || null)}
                          >
                            <option value="">None (leave pending)</option>
                            {sourcingAgents.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            Unresolved
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_VARIANT[row.status]}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.errors.length > 0 ? (
                          <ul className="text-xs text-destructive list-disc list-inside space-y-1">
                            {row.errors.map((err: string, idx: number) => (
                              <li key={idx}>{err}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {preview.preview.readyCount} ready · {preview.preview.pendingCount} pending review
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setError(null)
                }}
                disabled={pendingRows.length === 0}
              >
                Mark Pending for Review
              </Button>
              <Button
                onClick={onImport}
                disabled={!canImport || importing}
                className="bg-success text-success-foreground hover:bg-success/90"
              >
                {importing ? "Importing…" : `Import ${readyRows.length} Ready Row(s)`}
              </Button>
            </div>
          </div>

          {importResult && (
            <Dialog open={true} onClose={() => setImportResult(null)} title="Import Results">
              <div className="space-y-3">
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total rows:</span>
                    <span>{importResult.totalRows}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-success font-medium">Imported:</span>
                    <span className="font-mono">{importResult.importedCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-warning font-medium">Pending review:</span>
                    <span className="font-mono">{importResult.pendingCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-destructive font-medium">Errors:</span>
                    <span className="font-mono">{importResult.errorCount}</span>
                  </div>
                </div>
                {importResult.imported.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-success mb-2">Imported routes</h3>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {importResult.imported.map((imp: { rowIndex: number; id: string; qualificationId: string; rtoId: string; sourceAgentId: string; wholesaleCost: number }) => (
                        <li key={imp.id}>
                          {imp.qualificationId} → {imp.rtoId} @ {formatCurrency(imp.wholesaleCost)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {importResult.pending.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-warning mb-2">Pending review (not imported)</h3>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {importResult.pending.map((p: { rowIndex: number; reason: string }) => (
                        <li key={p.rowIndex}>
                          Row {p.rowIndex + 1}: {p.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {importResult.errors.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-destructive mb-2">Errors</h3>
                    <ul className="text-xs list-disc list-inside space-y-1">
                      {importResult.errors.map((e: { rowIndex: number; code: string; message: string }) => (
                        <li key={e.rowIndex}>
                          Row {e.rowIndex + 1}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Dialog>
          )}
        </>
      )}
    </div>
  )
}
