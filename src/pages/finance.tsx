import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import { hasPermission } from "@/lib/permissions"
import {
  addInstalment,
  createInvoice,
  createPlan,
  financeSummary,
  getPlan,
  listInvoices,
  listPayments,
  listQBSync,
  qbStatusFor,
  recordPayment,
  refundPayment,
  retryQBSync,
  voidInvoice,
  type FinanceSummary,
} from "@/lib/fin-store"
import { listClients, listOrders } from "@/lib/ops-store"
import type { Client, Invoice, Order, Payment, PaymentMethod, QBSyncRecord } from "@/lib/types"
import { cn } from "@/lib/utils"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

import type { PaymentPlan } from "@/lib/types"

const aud = (n: number) => `AUD ${n.toLocaleString("en-AU")}`

const METHODS: PaymentMethod[] = ["Bank Transfer", "Card", "Cash", "Other"]

function InvoiceBadge({ status }: { status: Invoice["status"] }) {
  if (status === "Paid") return <Badge variant="success">Paid</Badge>
  if (status === "Part Paid") return <Badge variant="info">Part Paid</Badge>
  if (status === "Overdue") return <Badge variant="destructive">Overdue</Badge>
  if (status === "Void") return <Badge variant="outline">Void</Badge>
  return <Badge variant="secondary">{status}</Badge>
}

function QBBadge({ status }: { status: string }) {
  if (status === "Synced") return <Badge variant="success">Synced</Badge>
  if (status === "Failed") return <Badge variant="destructive">Failed</Badge>
  if (status === "Pending") return <Badge variant="warning">Pending</Badge>
  return <Badge variant="outline">Not Synced</Badge>
}

export function FinancePage() {
  const { user, permissions } = useAuth()
  const actor = user?.id ?? "preview-user"
  const [tab, setTab] = useState<"Invoices" | "Plans" | "Payments" | "QuickBooks">("Invoices")

  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [qbRows, setQbRows] = useState<QBSyncRecord[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [qbMap, setQbMap] = useState<Record<string, string>>({})

  const [creatingInv, setCreatingInv] = useState(false)
  const [invOrder, setInvOrder] = useState("")
  const [invTotal, setInvTotal] = useState("")
  const [invDue, setInvDue] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [planOrder, setPlanOrder] = useState("")
  const [activePlan, setActivePlan] = useState<PaymentPlan | null>(null)
  const [addingInst, setAddingInst] = useState(false)
  const [instDue, setInstDue] = useState("")
  const [instAmount, setInstAmount] = useState("")

  const [recording, setRecording] = useState(false)
  const [payOrder, setPayOrder] = useState("")
  const [payInvoice, setPayInvoice] = useState("")
  const [payAmount, setPayAmount] = useState("")
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState<PaymentMethod>("Bank Transfer")
  const [payRef, setPayRef] = useState("")
  const [payResult, setPayResult] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [inv, o, c, s, pay, q] = await Promise.all([
        listInvoices(),
        listOrders(),
        listClients(),
        financeSummary(),
        listPayments(),
        listQBSync(),
      ])
      setInvoices(inv)
      setOrders(o)
      setClients(c)
      setSummary(s)
      setPayments(pay)
      setQbRows(q)
      const m: Record<string, string> = {}
      for (const i of inv) m[i.id] = await qbStatusFor("invoice", i.id)
      setQbMap(m)
    })()
  }, [])

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])

  async function refreshPlans(orderId: string) {
    setActivePlan((await getPlan(orderId)) ?? null)
  }

  async function onCreateInvoice(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const total = Number(invTotal)
    if (!invOrder || !invDue) {
      setFormError("Order and due date are required.")
      return
    }
    if (!Number.isFinite(total) || total <= 0) {
      setFormError("Total must be a positive number.")
      return
    }
    setSaving(true)
    try {
      const created = await createInvoice({ orderId: invOrder, total, dueDate: invDue }, actor)
      setInvoices((prev) => (prev ? [created, ...prev] : [created]))
      setQbMap((m) => ({ ...m, [created.id]: "Not Synced" }))
      setSummary(await financeSummary())
      setCreatingInv(false)
      setInvOrder("")
      setInvTotal("")
      setInvDue("")
    } finally {
      setSaving(false)
    }
  }

  async function onRecordPayment(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setPayResult(null)
    const amount = Number(payAmount)
    if (!payOrder || !payDate || !payRef.trim()) {
      setFormError("Order, date, and reference are required.")
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Amount must be a positive number.")
      return
    }
    setSaving(true)
    try {
      const created = await recordPayment(
        {
          orderId: payOrder,
          invoiceId: payInvoice || null,
          amount,
          date: payDate,
          method: payMethod,
          reference: payRef.trim(),
        },
        actor,
      )
      setPayments((prev) => [created, ...prev])
      setQbRows(await listQBSync())
      setInvoices(await listInvoices())
      setSummary(await financeSummary())
      setPayResult(
        `Recorded ${aud(created.amount)} — allocated ${aud(created.allocatedAmount)} (${created.status}).`,
      )
      setPayOrder("")
      setPayInvoice("")
      setPayAmount("")
      setPayRef("")
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not record payment.")
    } finally {
      setSaving(false)
    }
  }

  async function onRefund(p: Payment) {
    const updated = await refundPayment(p.id, actor)
    setPayments((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    setSummary(await financeSummary())
  }

  async function onRetryQB(r: QBSyncRecord) {
    const updated = await retryQBSync(r.entityType, r.entityId, actor)
    setQbRows((prev) => prev.map((x) => (x.entityType === updated.entityType && x.entityId === updated.entityId ? updated : x)))
    setInvoices(await listInvoices())
  }

  const canRetryQB = hasPermission(permissions, "qb.retry")

  async function onVoid(inv: Invoice) {
    const updated = await voidInvoice(inv.id, actor)
    setInvoices((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null)
    setSummary(await financeSummary())
  }

  async function onCreatePlan() {
    if (!planOrder) return
    const existing = await getPlan(planOrder)
    if (existing) {
      setActivePlan(existing)
      return
    }
    const order = orderById.get(planOrder)
    const created = await createPlan(planOrder, order?.sellingPrice ?? 0, actor)
    setActivePlan(created)
  }

  async function onAddInstalment(e: FormEvent) {
    e.preventDefault()
    if (!activePlan) return
    const amount = Number(instAmount)
    if (!instDue || !Number.isFinite(amount) || amount <= 0) return
    const updated = await addInstalment(activePlan.id, instDue, amount, actor)
    setActivePlan(updated)
    setAddingInst(false)
    setInstDue("")
    setInstAmount("")
  }

  const tabs = ["Invoices", "Plans", "Payments", "QuickBooks"] as const

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Finance</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Invoices, instalment plans, payments, QuickBooks sync
          </p>
        </div>
        <Badge variant="info">Preview data</Badge>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 pt-4 lg:grid-cols-4">
          {[
            { label: "Invoiced", value: aud(summary.invoiced) },
            { label: "Paid", value: aud(summary.paid) },
            { label: "Outstanding", value: aud(summary.outstanding) },
            { label: "Overdue", value: aud(summary.overdue) },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
            </div>
          ))}
        </div>
      )}

      <div role="tablist" aria-label="Finance sections" className="flex gap-1 overflow-x-auto border-b pt-4">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {tab === "Invoices" && (
          <TabPanel
            action={
              <Button size="sm" onClick={() => setCreatingInv(true)}>
                New invoice
              </Button>
            }
          >
            {!invoices ? (
              <Skeleton className="h-64 w-full" aria-label="Loading invoices" />
            ) : (
              <DataTable<Invoice>
                rows={invoices}
                emptyMessage="No invoices yet."
                rowLabel={(i) => i.invoiceNumber}
                columns={[
                  { key: "invoiceNumber", label: "Invoice" },
                  {
                    key: "order",
                    label: "Order",
                    render: (i) => (
                      <Link to={`/orders/${i.orderId}`} className="text-xs text-primary underline-offset-4 hover:underline">
                        {clientById.get(orderById.get(i.orderId)?.clientId ?? "")?.legalName ?? i.orderId}
                      </Link>
                    ),
                  },
                  { key: "total", label: "Total", render: (i) => <span className="tabular-nums">{aud(i.total)}</span> },
                  { key: "dueDate", label: "Due", render: (i) => <span className="tabular-nums">{i.dueDate}</span> },
                  { key: "status", label: "Status", render: (i) => <InvoiceBadge status={i.status} /> },
                  { key: "qb", label: "QuickBooks", render: (i) => <QBBadge status={qbMap[i.id] ?? "Not Synced"} /> },
                  {
                    key: "actions",
                    label: "Actions",
                    render: (i) =>
                      i.status !== "Void" && i.status !== "Paid" ? (
                        <Button size="sm" variant="outline" onClick={() => void onVoid(i)}>
                          Void
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      ),
                  },
                ]}
              />
            )}
          </TabPanel>
        )}

        {tab === "Plans" && (
          <TabPanel>
            <div className="flex flex-wrap gap-2 pb-3">
              <select aria-label="Select order for plan" value={planOrder} onChange={(e) => { setPlanOrder(e.target.value); if (e.target.value) void refreshPlans(e.target.value) }} className={`${inputCls} w-auto`}>
                <option value="">Select order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {clientById.get(o.clientId)?.legalName ?? o.id} · {aud(o.sellingPrice)}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={() => void onCreatePlan()} disabled={!planOrder}>
                Open / create plan
              </Button>
              {activePlan && (
                <Button size="sm" onClick={() => setAddingInst(true)}>
                  Add instalment
                </Button>
              )}
            </div>
            {!activePlan ? (
              <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
                Pick an order to view its unlimited instalment schedule.
              </p>
            ) : (
              <DataTable
                rows={activePlan.instalments.map((x) => ({ ...x, id: x.id }))}
                emptyMessage="Plan has no instalments — add the first one."
                rowLabel={(x) => `${x.dueDate} ${x.amount}`}
                columns={[
                  { key: "dueDate", label: "Due date" },
                  { key: "amount", label: "Amount", render: (x) => <span className="tabular-nums">{aud(x.amount)}</span> },
                  { key: "paidAmount", label: "Paid", render: (x) => <span className="tabular-nums">{aud(x.paidAmount)}</span> },
                  {
                    key: "status",
                    label: "Status",
                    render: (x) =>
                      x.status === "Paid" ? (
                        <Badge variant="success">Paid</Badge>
                      ) : x.status === "Overdue" ? (
                        <Badge variant="destructive">Overdue</Badge>
                      ) : x.status === "Part Paid" ? (
                        <Badge variant="info">Part Paid</Badge>
                      ) : (
                        <Badge variant="secondary">{x.status}</Badge>
                      ),
                  },
                ]}
              />
            )}
          </TabPanel>
        )}

        {tab === "Payments" && (
          <TabPanel
            action={
              <Button size="sm" onClick={() => setRecording(true)}>
                Record payment
              </Button>
            }
          >
            <DataTable<Payment>
              rows={payments}
              emptyMessage="No payments recorded yet."
              rowLabel={(p) => `${p.reference} ${p.amount}`}
              columns={[
                { key: "date", label: "Date", render: (p) => <span className="tabular-nums">{p.date}</span> },
                { key: "reference", label: "Reference" },
                {
                  key: "order",
                  label: "Order",
                  render: (p) => (
                    <Link to={`/orders/${p.orderId}`} className="text-xs text-primary underline-offset-4 hover:underline">
                      {clientById.get(orderById.get(p.orderId)?.clientId ?? "")?.legalName ?? p.orderId}
                    </Link>
                  ),
                },
                { key: "method", label: "Method" },
                { key: "amount", label: "Amount", render: (p) => <span className="font-medium tabular-nums">{aud(p.amount)}</span> },
                { key: "allocatedAmount", label: "Allocated", render: (p) => <span className="tabular-nums">{aud(p.allocatedAmount)}</span> },
                {
                  key: "status",
                  label: "Status",
                  render: (p) =>
                    p.status === "Allocated" ? (
                      <Badge variant="success">Allocated</Badge>
                    ) : p.status === "Refunded" || p.status === "Void" ? (
                      <Badge variant="outline">{p.status}</Badge>
                    ) : (
                      <Badge variant="warning">{p.status}</Badge>
                    ),
                },
                {
                  key: "actions",
                  label: "Actions",
                  render: (p) =>
                    p.status !== "Refunded" && p.status !== "Void" ? (
                      <Button size="sm" variant="outline" onClick={() => void onRefund(p)}>
                        Refund
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
          </TabPanel>
        )}

        {tab === "QuickBooks" && (
          <TabPanel>
            <p className="pb-3 text-xs text-muted-foreground">
              Async idempotent queue — retries reuse the same idempotency key, so a
              retried job can never create a duplicate invoice or payment.
            </p>
            <DataTable
              rows={qbRows.map((r) => ({ ...r, id: `${r.entityType}-${r.entityId}` }))}
              emptyMessage="Nothing queued for sync."
              rowLabel={(r) => `${r.entityType} ${r.entityId}`}
              columns={[
                { key: "entity", label: "Entity", render: (r) => <span className="text-xs">{r.entityType} · <code>{r.entityId}</code></span> },
                { key: "idempotencyKey", label: "Idempotency key", render: (r) => <code className="text-xs">{r.idempotencyKey}</code> },
                { key: "status", label: "Status", render: (r) => <QBBadge status={r.status} /> },
                { key: "attempts", label: "Attempts", render: (r) => <span className="tabular-nums">{r.attempts}</span> },
                { key: "syncError", label: "Last error", render: (r) => <span className="text-xs text-muted-foreground">{r.syncError ?? "—"}</span> },
                {
                  key: "actions",
                  label: "Actions",
                  render: (r) =>
                    r.status === "Failed" ? (
                      canRetryQB ? (
                        <Button size="sm" variant="outline" onClick={() => void onRetryQB(r)}>
                          Retry
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">No retry permission</span>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.qbReference ?? "—"}</span>
                    ),
                },
              ]}
            />
          </TabPanel>
        )}
      </div>

      <Dialog
        open={recording}
        onClose={() => setRecording(false)}
        title="Record payment"
        description="Actual money in — auto-allocated oldest-due-first across the plan."
      >
        <form onSubmit={onRecordPayment} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pay-order" className="text-sm font-medium">Order</label>
              <select
                id="pay-order"
                value={payOrder}
                onChange={(e) => {
                  setPayOrder(e.target.value)
                  setPayInvoice("")
                }}
                className={inputCls}
              >
                <option value="">Select order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {clientById.get(o.clientId)?.legalName ?? o.id} · {aud(o.sellingPrice)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pay-inv" className="text-sm font-medium">Invoice (optional)</label>
              <select id="pay-inv" value={payInvoice} onChange={(e) => setPayInvoice(e.target.value)} className={inputCls}>
                <option value="">None</option>
                {(invoices ?? []).filter((i) => !payOrder || i.orderId === payOrder).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoiceNumber} · {aud(i.total)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="pay-amt" className="text-sm font-medium">Amount (AUD)</label>
              <input id="pay-amt" type="number" min="1" step="1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="500" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pay-date" className="text-sm font-medium">Date</label>
              <input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pay-method" className="text-sm font-medium">Method</label>
              <select id="pay-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} className={inputCls}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pay-ref" className="text-sm font-medium">Reference</label>
            <input id="pay-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="BT-0007 / receipt no." className={inputCls} />
          </div>
          {formError && (
            <p role="alert" className="text-sm text-destructive">{formError}</p>
          )}
          {payResult && (
            <p role="status" className="text-sm text-success">{payResult}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRecording(false)}>
              Close
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Recording…" : "Record payment"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={creatingInv}
        onClose={() => setCreatingInv(false)}
        title="New invoice"
        description="Linked to one order. A QuickBooks sync record is queued automatically."
      >
        <form onSubmit={onCreateInvoice} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="inv-order" className="text-sm font-medium">Order</label>
            <select id="inv-order" value={invOrder} onChange={(e) => setInvOrder(e.target.value)} className={inputCls}>
              <option value="">Select order…</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {clientById.get(o.clientId)?.legalName ?? o.id} · {aud(o.sellingPrice)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="inv-total" className="text-sm font-medium">Total (AUD)</label>
              <input id="inv-total" type="number" min="1" step="1" value={invTotal} onChange={(e) => setInvTotal(e.target.value)} placeholder="2500" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="inv-due" className="text-sm font-medium">Due date</label>
              <input id="inv-due" type="date" value={invDue} onChange={(e) => setInvDue(e.target.value)} className={inputCls} />
            </div>
          </div>
          {formError && (
            <p role="alert" className="text-sm text-destructive">{formError}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreatingInv(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create invoice"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={addingInst}
        onClose={() => setAddingInst(false)}
        title="Add instalment"
        description="Schedules are unlimited — never fixed columns."
      >
        <form
          onSubmit={onAddInstalment}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <div className="space-y-1.5">
            <label htmlFor="inst-due" className="text-sm font-medium">Due date</label>
            <input id="inst-due" type="date" value={instDue} onChange={(e) => setInstDue(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="inst-amt" className="text-sm font-medium">Amount (AUD)</label>
            <input id="inst-amt" type="number" min="1" step="1" value={instAmount} onChange={(e) => setInstAmount(e.target.value)} placeholder="500" className={inputCls} />
          </div>
          <Button type="submit">Add</Button>
        </form>
      </Dialog>
    </div>
  )
}

function TabPanel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div>
      {action && <div className="flex justify-end pb-3">{action}</div>}
      {children}
    </div>
  )
}
