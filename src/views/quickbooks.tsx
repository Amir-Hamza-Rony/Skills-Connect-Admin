"use client"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const CONN_VARIANT: Record<string, "success" | "warning" | "outline" | "destructive"> = {
  connected: "success",
  disconnected: "outline",
  error: "destructive",
  expired: "warning",
}

export function QuickBooksPage() {
  const [status, setStatus] = useState<any | null>(null)
  const [syncs, setSyncs] = useState<any[] | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectUrl, setConnectUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectDialog, setConnectDialog] = useState(false)

  useEffect(() => {
    void (async () => {
      const [st, sy] = await Promise.all([
        fetch("/api/integrations/quickbooks/status").then((r) => r.json()),
        fetch("/api/integrations/quickbooks/sync").then((r) => r.json()),
      ])
      setStatus(st)
      setSyncs(sy.records ?? [])
    })()
  }, [])

  async function connect() {
    setError(null)
    setConnecting(true)
    try {
      const res = await fetch("/api/integrations/quickbooks/connect", { method: "GET" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.message ?? "Connect failed.")
        return
      }
      const data = await res.json()
      setConnectUrl(data.url)
      setConnectDialog(true)
    } catch {
      setError("Connect failed.")
    } finally {
      setConnecting(false)
    }
  }

  async function disconnect() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch("/api/integrations/quickbooks/disconnect", {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.message ?? "Disconnect failed.")
        return
      }
      setStatus((prev: any) => (prev ? { ...prev, connectionStatus: "disconnected", authorised: false } : prev))
    } catch {
      setError("Disconnect failed.")
    } finally {
      setSaving(false)
    }
  }

  if (!status) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading QuickBooks" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            QuickBooks
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Two-way sync for customers, invoices, and payments.
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h2 className="pb-3 text-sm font-semibold">Connection</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Configured</p>
            <Badge variant={status.configured ? "success" : "outline"}>
              {status.configured ? "Yes" : "No"}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Authorised</p>
            <Badge variant={status.authorised ? "success" : "outline"}>
              {status.authorised ? "Yes" : "No"}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Connection status</p>
            <Badge variant={CONN_VARIANT[status.connectionStatus ?? "disconnected"] ?? "outline"}>
              {status.connectionStatus ?? "disconnected"}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Realm</p>
            <span className="text-sm">{status.realmId ?? "—"}</span>
          </div>
        </div>

        <div className="pt-4 flex gap-3">
          {!status.authorised && (
            <Button size="sm" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect to QuickBooks"}
            </Button>
          )}
          {status.authorised && (
            <Button size="sm" variant="destructive" onClick={disconnect} disabled={saving}>
              {saving ? "Disconnecting…" : "Disconnect"}
            </Button>
          )}
        </div>

        {status.configured && !status.authorised && (
          <p className="pt-3 text-xs text-muted-foreground">
            Click Connect to authorise Skills Connect Admin in QuickBooks. Tokens are
            stored encrypted at rest and are never exposed to the browser.
          </p>
        )}
        {!status.configured && (
          <p className="pt-3 text-xs text-muted-foreground text-destructive">
            QuickBooks is not configured. Set QB_CLIENT_ID, QB_CLIENT_SECRET, and
            QB_ENCRYPTION_KEY in the server environment.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-xl border bg-card p-6">
        <h2 className="pb-3 text-sm font-semibold">Sync queue</h2>
        <DataTable<any>
          rows={syncs ?? []}
          emptyMessage="No sync records."
          rowLabel={(r) => `${r.entityType} ${r.entityId}`}
          columns={[
            { key: "entityType", label: "Type", render: (r: any) => r.entityType },
            {
              key: "direction",
              label: "Direction",
              render: (r: any) => r.direction ?? "—",
            },
            { key: "entityId", label: "Entity id", render: (r: any) => r.entityId },
            {
              key: "status",
              label: "Status",
              render: (r: any) => (
                <Badge variant={r.status === "Synced" ? "success" : r.status === "Failed" ? "destructive" : "warning"}>
                  {r.status}
                </Badge>
              ),
            },
            { key: "attempts", label: "Attempts", render: (r: any) => r.attempts },
            {
              key: "qbReference",
              label: "QB reference",
              render: (r: any) => r.qbReference ?? "—",
            },
            {
              key: "syncError",
              label: "Last error",
              render: (r: any) => <span className="text-xs text-muted-foreground">{r.syncError ?? "—"}</span>,
            },
          ]}
        />
      </div>

      <Dialog
        open={connectDialog}
        onClose={() => setConnectDialog(false)}
        title="Connect to QuickBooks"
        description="You will be redirected to Intuit to authorise access."
      >
        <p className="mb-4 text-sm">
          Authorise Skills Connect Admin to access your QuickBooks company data. You will
          be redirected to Intuit&rsquo;s consent page.
        </p>
        <div className="flex justify-end">
          <a
            href={connectUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" onClick={() => setConnectDialog(false)}>
              Open QuickBooks consent
            </Button>
          </a>
        </div>
      </Dialog>

      {error && (
        <Dialog open={true} onClose={() => setError(null)} title="Error">
          <p role="alert" className="text-sm text-destructive">{error}</p>
        </Dialog>
      )}
    </div>
  )
}
