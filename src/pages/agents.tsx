import { useEffect, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { agentLabel, createAgent, listAgents, updateAgent } from "@/lib/store"
import type { Agent, AgentType } from "@/lib/types"
import { cn } from "@/lib/utils"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const TYPE_TABS: Array<{ value: AgentType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "sales_closing", label: "Sales / Closing" },
  { value: "certificate_source", label: "Certificate Source" },
  { value: "rto_contact", label: "RTO Contact" },
]

const TYPE_BADGE: Record<AgentType, "info" | "warning" | "secondary"> = {
  sales_closing: "info",
  certificate_source: "warning",
  rto_contact: "secondary",
}

const TYPE_LABEL: Record<AgentType, string> = {
  sales_closing: "Sales / Closing",
  certificate_source: "Certificate Source",
  rto_contact: "RTO Contact",
}

/**
 * Agent directory with three SEPARATE types (Spec §4D) — never merged
 * into one generic field. Sales ≠ source ≠ RTO contact.
 */
export function AgentsPage() {
  const [rows, setRows] = useState<Agent[] | null>(null)
  const [tab, setTab] = useState<AgentType | "all">("all")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<AgentType>("sales_closing")
  const [contact, setContact] = useState("")
  const [commission, setCommission] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => setRows(await listAgents()))()
  }, [])

  const visible = (rows ?? []).filter((a) => tab === "all" || a.type === tab)

  async function toggleActive(a: Agent) {
    const updated = await updateAgent(a.id, { active: !a.active })
    setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !contact.trim()) {
      setError("Name and contact are required.")
      return
    }
    setSaving(true)
    try {
      const created = await createAgent({
        name: name.trim(),
        type,
        contact: contact.trim(),
        commissionRule: commission.trim() || "N/A",
        active: true,
      })
      setRows((prev) => (prev ? [created, ...prev] : [created]))
      setCreating(false)
      setName("")
      setContact("")
      setCommission("")
      setType("sales_closing")
    } finally {
      setSaving(false)
    }
  }

  if (!rows) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading agents" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Agents</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Sales, certificate-source, and RTO contacts · {visible.length} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">Preview data</Badge>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add agent
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="Agent type" className="flex flex-wrap gap-1.5 pb-4">
        {TYPE_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              tab === t.value
                ? "border-primary/50 bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DataTable<Agent>
        rows={visible}
        emptyMessage="No agents of this type yet."
        rowLabel={agentLabel}
        columns={[
          { key: "name", label: "Name" },
          {
            key: "type",
            label: "Type",
            render: (a) => <Badge variant={TYPE_BADGE[a.type]}>{TYPE_LABEL[a.type]}</Badge>,
          },
          { key: "contact", label: "Contact" },
          { key: "commissionRule", label: "Commission rule" },
          {
            key: "active",
            label: "Status",
            render: (a) =>
              a.active ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="outline">Inactive</Badge>
              ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (a) => (
              <Button size="sm" variant="outline" onClick={() => toggleActive(a)}>
                {a.active ? "Deactivate" : "Activate"}
              </Button>
            ),
          },
        ]}
      />

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add agent"
        description="Pick the correct type — roles are never merged."
      >
        <form onSubmit={onCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ag-name" className="text-sm font-medium">Name</label>
              <input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ag-type" className="text-sm font-medium">Type</label>
              <select id="ag-type" value={type} onChange={(e) => setType(e.target.value as AgentType)} className={inputCls}>
                <option value="sales_closing">Sales / Closing Agent</option>
                <option value="certificate_source">Certificate Source Agent</option>
                <option value="rto_contact">RTO Contact</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ag-contact" className="text-sm font-medium">Contact</label>
              <input id="ag-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ag-comm" className="text-sm font-medium">Commission rule</label>
              <input id="ag-comm" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="10% of margin" className={inputCls} />
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
              {saving ? "Adding…" : "Add agent"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
