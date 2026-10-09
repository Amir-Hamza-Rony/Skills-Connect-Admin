import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient, listClients } from "@/lib/ops-store"
import { listAgents, agentLabel } from "@/lib/store"
import type { Agent, Client } from "@/lib/types"
import { useMemo } from "react"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

export function ClientsPage() {
  const [rows, setRows] = useState<Client[] | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [creating, setCreating] = useState(false)
  const [legalName, setLegalName] = useState("")
  const [preferredName, setPreferredName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [address, setAddress] = useState("")
  const [sourceAgentId, setSourceAgentId] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setRows(await listClients())
      setAgents(await listAgents())
    })()
  }, [])

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const salesAgents = useMemo(
    () => agents.filter((a) => a.type === "sales_closing" && a.active),
    [agents],
  )

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!legalName.trim() || !phone.trim() || !email.trim()) {
      setError("Legal name, phone, and email are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createClient({
        legalName: legalName.trim(),
        preferredName: preferredName.trim() || legalName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        status: "Active",
        sourceAgentId: sourceAgentId || null,
        notes: notes.trim(),
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setLegalName("")
      setPreferredName("")
      setPhone("")
      setEmail("")
      setAddress("")
      setSourceAgentId("")
      setNotes("")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading clients" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Clients</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One record per client — never duplicated per certificate · {rows.length} clients
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">Preview data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add client
          </Button>
        </div>
      </div>

      <DataTable<Client>
        rows={rows}
        emptyMessage="No clients yet — add the first one."
        rowLabel={(c) => c.legalName}
        columns={[
          {
            key: "legalName",
            label: "Client",
            render: (c) => (
              <span>
                <Link
                  to={`/clients/${c.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {c.legalName}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {c.preferredName} · {c.phone}
                </span>
              </span>
            ),
          },
          { key: "email", label: "Email" },
          {
            key: "agent",
            label: "Sales agent",
            render: (c) =>
              c.sourceAgentId ? (agentById.get(c.sourceAgentId)?.name ?? "—") : "—",
          },
          {
            key: "status",
            label: "Status",
            render: (c) =>
              c.status === "Active" ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="warning">{c.status}</Badge>
              ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add client"
        description="Created once — certificates attach as separate orders."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="c-legal" className="text-sm font-medium">Legal name</label>
              <input id="c-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Full legal name" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="c-pref" className="text-sm font-medium">Preferred name</label>
              <input id="c-pref" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} placeholder="What they go by" className={inputCls} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="c-phone" className="text-sm font-medium">Phone</label>
              <input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="04xx xxx xxx" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="c-email" className="text-sm font-medium">Email</label>
              <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" className={inputCls} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="c-addr" className="text-sm font-medium">Address</label>
            <input id="c-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City STATE" className={inputCls} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="c-agent" className="text-sm font-medium">Sales / closing agent</label>
              <select id="c-agent" value={sourceAgentId} onChange={(e) => setSourceAgentId(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {salesAgents.map((a) => (
                  <option key={a.id} value={a.id}>{agentLabel(a)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="c-notes" className="text-sm font-medium">Notes</label>
              <input id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Preferences…" className={inputCls} />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add client"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
