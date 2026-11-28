"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/data-table"
import { Dialog } from "@/components/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/auth"
import { getClient } from "@/lib/ops-store"
import { listOrders } from "@/lib/ops-store"
import type { Client, Order } from "@/lib/types"

const ID_POINTS: Array<{ label: string; points: number }> = [
  { label: "Passport", points: 70 },
  { label: "Citizenship Certificate", points: 70 },
  { label: "Birth Certificate", points: 70 },
  { label: "Australian Driver's Licence", points: 40 },
  { label: "Government Photo ID", points: 40 },
  { label: "Work ID Card", points: 35 },
  { label: "Medicare Card", points: 25 },
  { label: "Credit Card", points: 25 },
  { label: "Utility Bill", points: 25 },
  { label: "Bank Statement", points: 25 },
  { label: "Rental Lease Agreement", points: 25 },
  { label: "Foreign Driver's Licence", points: 20 },
  { label: "Student ID", points: 20 },
]

export default function ClientDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const clientId = typeof id === "string" ? id : id?.[0] ?? ""
  const [client, setClient] = useState<Client | null>(null)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [usiVerified, setUsiVerified] = useState(false)
  const [idPoints, setIdPoints] = useState(0)
  const [idPointsTarget, setIdPointsTarget] = useState(100)
  const [creatingOrder, setCreatingOrder] = useState(false)

  useEffect(() => {
    void (async () => {
      if (!clientId) return
      const [c, o] = await Promise.all([getClient(clientId), listOrders(clientId)])
      setClient(c ?? null)
      setOrders(o ?? null)
      setUsiVerified(!!c?.usiNumber)
      setIdPoints(c?.id_points_verified ?? 0)
    })()
  }, [clientId])

  if (!client || !orders) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 p-4 sm:p-6">
        <Skeleton className="h-10 w-56" aria-label="Loading client" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const idPointsPercent = Math.min((idPoints / idPointsTarget) * 100, 100)

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {client.legalName}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Master student profile · {client.preferredName || "—"} · {client.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              client.status === "Active"
                ? "success"
                : client.status === "Prospect"
                  ? "warning"
                  : "secondary"
            }
          >
            {client.status}
          </Badge>
          <Badge variant={usiVerified ? "success" : "outline"}>
            USI {usiVerified ? "Verified" : "Pending"}
          </Badge>
          <Badge variant={idPoints >= 100 ? "success" : "warning"}>
            ID {idPoints}/100 pts
          </Badge>
          <Button size="sm" onClick={() => setCreatingOrder(true)}>
            New Application
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <Card className="p-4">
          <CardHeader>
            <CardTitle>USI Number</CardTitle>
            <CardDescription>
              {client.usiNumber ?? "Not on file"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {usiVerified ? (
              <Badge variant="success">Verified</Badge>
            ) : (
              <Badge variant="outline">Unverified</Badge>
            )}
          </CardContent>
        </Card>
        <Card className="p-4">
          <CardHeader>
            <CardTitle>Date of Birth</CardTitle>
            <CardDescription>{client.dob ?? "Not on file"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{client.visaStatus ?? "Not recorded"}</Badge>
          </CardContent>
        </Card>
        <Card className="p-4">
          <CardHeader>
            <CardTitle>100-Point ID</CardTitle>
            <CardDescription>{idPoints} of {idPointsTarget} verified</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="w-full bg-secondary/30 rounded-full h-2 mb-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-500"
                style={{ width: `${idPointsPercent}%` }}
              />
            </div>
            <Badge variant={idPoints >= 100 ? "success" : "warning"}>
              {idPoints >= 100 ? "Fully Verified" : "In Progress"}
            </Badge>
          </CardContent>
        </Card>
        <Card className="p-4">
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>{orders.length} linked</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-sm text-muted-foreground">
              1 candidate → {orders.length} applications
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>USI Verification</CardTitle>
            <CardDescription>
              Unique Student Identifier for AVETMISS reporting
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="usi-input" className="text-sm font-medium">
                USI Number (10 characters)
              </Label>
              <Input
                id="usi-input"
                value={client.usiNumber ?? ""}
                disabled
                placeholder="1234567890"
                className="h-9 w-full rounded-md border bg-muted px-3 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {usiVerified
                  ? "USI is verified and on file."
                  : "USI not yet verified. Candidate must complete USI verification in the applicant portal."}
              </p>
            </div>
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Consent Authority
              </p>
              <p className="text-sm text-muted-foreground">
                Town/City of Birth and ID document metadata required for USI
                application.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>100-Point ID Vault</CardTitle>
            <CardDescription>
              Verified identity documents for enrolment
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Verified Points: {idPoints} / {idPointsTarget}
              </Label>
              <div className="w-full bg-secondary/30 rounded-full h-3 mb-3">
                <div
                  className={[
                    "h-3 rounded-full transition-all duration-500",
                    idPoints >= 100 ? "bg-success" : "bg-primary",
                  ].join(" ")}
                  style={{ width: `${idPointsPercent}%` }}
                />
              </div>
              {idPoints >= 100 ? (
                <Badge variant="success" className="w-full">
                  ID Verification Complete
                </Badge>
              ) : (
                <Badge variant="warning" className="w-full">
                  {100 - idPoints} points remaining
                </Badge>
              )}
            </div>

            <div className="border rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
              {ID_POINTS.map((doc) => (
                <div key={doc.label} className="flex items-center justify-between text-sm py-1">
                  <span className="text-muted-foreground">{doc.label}</span>
                  <Badge variant="secondary">{doc.points} pts</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Addresses &amp; Contacts</CardTitle>
            <CardDescription>
              Residential, mailing, and emergency contact details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {client.addresses.length > 0 ? (
              <div className="space-y-3">
                {client.addresses.map((addr, i) => (
                  <div key={i} className="border p-3 rounded-lg bg-muted/50">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-medium">{addr.label}</span>
                      {addr.primary && <Badge variant="outline">Primary</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">
                      {addr.street}{addr.city ? ", " : ""}{addr.city}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {addr.state}{addr.postalCode ? " " : ""}{addr.postalCode}{addr.country ? ", " : ""}{addr.country}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No addresses on file.</p>
            )}

            <div className="border-t pt-3 space-y-2">
              <Label className="text-sm font-medium">Contact Methods</Label>
              {client.contacts.length > 0 ? (
                <div className="space-y-2">
                  {client.contacts.map((ct, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{ct.label} ({ct.type})</span>
                      <span className="font-medium">{ct.value}</span>
                      {ct.primary && <Badge variant="outline">Primary</Badge>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No contacts on file.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linked Applications</CardTitle>
          <CardDescription>
            All enrolment orders for this candidate. 1 candidate → many
            applications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<Order>
            rows={orders}
            emptyMessage="No applications linked to this candidate yet."
            rowLabel={(o) => `Order ${o.id}`}
            columns={[
              {
                key: "id",
                label: "Order",
                render: (o) => (
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Order {o.id}
                  </Link>
                ),
              },
              {
                key: "qualificationId",
                label: "Qualification",
                render: (o) => (
                  <span className="text-muted-foreground">{o.qualificationId}</span>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (o) => (
                  <Badge variant={o.status === "DELIVERED" ? "success" : "secondary"}>
                    {o.status}
                  </Badge>
                ),
              },
              {
                key: "sellingPrice",
                label: "Selling Price",
                render: (o) => `AUD ${(o.sellingPrice ?? 0).toLocaleString()}`,
              },
              {
                key: "createdAt",
                label: "Created",
                render: (o) => new Date(o.createdAt).toLocaleDateString(),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog
        open={creatingOrder}
        onClose={() => setCreatingOrder(false)}
        title="New Application"
        description="Create a Level 1 quick lead intake application for this candidate."
      >
        <form className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-qual">Qualification</Label>
            <Input
              id="new-qual"
              placeholder="e.g. CHC33021"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-rto">Issuing RTO / Partner</Label>
            <Input
              id="new-rto"
              placeholder="Select mapped RTO"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-delivery">Delivery Mode</Label>
            <select
              id="new-delivery"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="RPL">RPL</option>
              <option value="ONLINE">Online</option>
              <option value="CLASSROOM">Classroom</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreatingOrder(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creatingOrder}>
              {creatingOrder ? "Creating…" : "Create Application"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
