import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Dialog } from "@/components/dialog"
import { listClients, listOrders } from "@/lib/ops-store"
import { listInvoices } from "@/lib/fin-store"
import { listQualifications, qualificationLabel } from "@/lib/store"
import type { Client, Invoice, Order, Qualification } from "@/lib/types"

interface Hit {
  kind: string
  label: string
  sub: string
  to: string
}

/** Global search across clients, orders, invoices, qualifications (Spec §13). */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [clients, setClients] = useState<Client[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [quals, setQuals] = useState<Qualification[]>([])

  useEffect(() => {
    if (!open) return
    void (async () => {
      const [c, o, i, q] = await Promise.all([
        listClients(),
        listOrders(),
        listInvoices(),
        listQualifications(),
      ])
      setClients(c)
      setOrders(o)
      setInvoices(i)
      setQuals(q)
    })()
  }, [open ])

  // Ctrl/Cmd+K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out: Hit[] = []
    for (const c of clients) {
      if ([c.legalName, c.preferredName, c.phone, c.email].some((f) => f.toLowerCase().includes(q))) {
        out.push({ kind: "Client", label: c.legalName, sub: `${c.phone} · ${c.email}`, to: `/clients/${c.id}` })
      }
    }
    for (const o of orders) {
      if (o.id.toLowerCase().includes(q)) {
        out.push({ kind: "Order", label: `Order ${o.id}`, sub: o.status, to: `/orders/${o.id}` })
      }
    }
    for (const i of invoices) {
      if (i.invoiceNumber.toLowerCase().includes(q)) {
        out.push({ kind: "Invoice", label: i.invoiceNumber, sub: i.status, to: "/finance" })
      }
    }
    for (const qu of quals) {
      if (qu.code.toLowerCase().includes(q) || qu.title.toLowerCase().includes(q)) {
        out.push({ kind: "Qualification", label: qualificationLabel(qu), sub: qu.industry, to: "/qualifications" })
      }
    }
    return out.slice(0, 12)
  }, [query, clients, orders, invoices, quals])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search (Ctrl+K)"
        title="Search — Ctrl+K"
        className="hidden h-9 items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex md:w-64"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Search clients, orders…</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Search">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Client, phone, invoice no., qualification code… (min 2 chars)"
          aria-label="Search query"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <ul className="max-h-72 overflow-y-auto pt-3">
          {hits.map((h, i) => (
            <li key={i}>
              <Link
                to={h.to}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{h.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{h.sub}</span>
                </span>
                <Badge variant="secondary">{h.kind}</Badge>
              </Link>
            </li>
          ))}
          {query.trim().length >= 2 && hits.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </li>
          )}
        </ul>
      </Dialog>
    </>
  )
}
