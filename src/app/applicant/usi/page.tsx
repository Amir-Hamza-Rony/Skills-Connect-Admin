"use client"

import { useCallback, useEffect, useState } from "react"
import { User, Mail, MapPin, Phone, CreditCard, CheckCircle2, AlertCircle, Info } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/**
 * USI Verification (/applicant/usi).
 *
 * Captures the student's 10-character Unique Student Identifier (usi_number),
 * verification status (Verified By, Date), and USI application consent authority
 * (Town/City of Birth + ID document metadata) (docs v5.1 §2 Module 2).
 */
export default function USIPage() {
  const { user } = useAuth()
  const [form, setForm] = useState({
    usiNumber: "",
    usiVerified: false,
    townCityOfBirth: "",
    idDocumentType: "",
    idDocumentNumber: "",
    idDocumentExpiry: "",
    legalName: "",
    dob: "",
    residentialAddress: "",
    postalAddress: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await api.get<{ items: any[] }>(`/applications?clientId=${user?.id}`)
        const app = (data.items ?? [])[0]
        if (app?.usiNumber) {
          setForm((prev) => ({
            ...prev,
            usiNumber: app.usiNumber ?? "",
            legalName: app.legalName ?? "",
            dob: app.dob ?? "",
            residentialAddress: app.residentialAddress ?? "",
            postalAddress: app.postalAddress ?? "",
            emergencyContactName: app.emergencyContactName ?? "",
            emergencyContactPhone: app.emergencyContactPhone ?? "",
          }))
        }
      } catch {
        // Ignore — form may not exist yet.
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const onChange = useCallback(
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
      setError(null)
    },
    [],
  )

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/applications/level-2", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("sc-access-token") ?? ""}`,
        },
        body: JSON.stringify({
          clientId: user?.id,
          step: 2,
          usiNumber: form.usiNumber,
          usiVerified: form.usiVerified,
          usiApplicationAuthority: {
            townCityOfBirth: form.townCityOfBirth,
            idDocumentType: form.idDocumentType,
            idDocumentNumber: form.idDocumentNumber,
            idDocumentExpiry: form.idDocumentExpiry,
          },
          legalName: form.legalName,
          dob: form.dob,
          residentialAddress: form.residentialAddress,
          postalAddress: form.postalAddress,
          emergencyContact: {
            name: form.emergencyContactName,
            phone: form.emergencyContactPhone,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error?.message ?? "Save failed.")
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError("Save failed. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const usiValid = /^[A-Z0-9]{10}$/.test(form.usiNumber)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">USI Verification</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Enter your Unique Student Identifier (10 characters) and supporting ID details.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Personal Details</CardTitle>
          <CardDescription className="text-xs">Legal name, date of birth and addresses.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="legalName">Legal Given Names</Label>
              <Input
                id="legalName"
                value={form.legalName}
                onChange={onChange("legalName")}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="familyName">Family Name</Label>
              <Input
                id="familyName"
                value={form.legalName}
                onChange={onChange("legalName")}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of Birth</Label>
              <Input
                id="dob"
                type="date"
                value={form.dob}
                onChange={onChange("dob")}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user?.email ?? ""}
                readOnly
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="residentialAddress">Residential Address (non-PO Box)</Label>
            <Input
              id="residentialAddress"
              value={form.residentialAddress}
              onChange={onChange("residentialAddress")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalAddress">Postal Address</Label>
            <Input
              id="postalAddress"
              value={form.postalAddress}
              onChange={onChange("postalAddress")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Emergency Contact</CardTitle>
          <CardDescription className="text-xs">Person to contact in an emergency.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContactName">Contact Name</Label>
            <Input
              id="emergencyContactName"
              value={form.emergencyContactName}
              onChange={onChange("emergencyContactName")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContactPhone">Contact Phone</Label>
            <Input
              id="emergencyContactPhone"
              type="tel"
              value={form.emergencyContactPhone}
              onChange={onChange("emergencyContactPhone")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">USI Details</CardTitle>
          <CardDescription className="text-xs">10-character Unique Student Identifier and consent.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="usiNumber">USI Number</Label>
            <Input
              id="usiNumber"
              maxLength={10}
              value={form.usiNumber}
              onChange={onChange("usiNumber")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring text-uppercase"
            />
            {form.usiNumber && !usiValid && (
              <p className="text-xs text-destructive">USI must be 10 alphanumeric characters.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="usiVerified"
              type="checkbox"
              checked={form.usiVerified}
              onChange={() => setForm((prev) => ({ ...prev, usiVerified: !prev.usiVerified }))}
              className="rounded border-input bg-background text-primary focus:ring-primary"
            />
            <Label htmlFor="usiVerified" className="text-sm text-muted-foreground">
              I have already verified my USI
            </Label>
          </div>
          <Separator />
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">USI Application Consent Authority</Label>
            <p className="text-xs text-muted-foreground">
              Capture Town/City of Birth plus ID document metadata for USI application consent.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="townCityOfBirth">Town / City of Birth</Label>
                <Input
                  id="townCityOfBirth"
                  value={form.townCityOfBirth}
                  onChange={onChange("townCityOfBirth")}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="idDocumentType">ID Document Type</Label>
                <Input
                  id="idDocumentType"
                  value={form.idDocumentType}
                  onChange={onChange("idDocumentType")}
                  placeholder="e.g. Driver's Licence, Passport, Medicare Card"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="idDocumentNumber">ID Document Number</Label>
                <Input
                  id="idDocumentNumber"
                  value={form.idDocumentNumber}
                  onChange={onChange("idDocumentNumber")}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="idDocumentExpiry">ID Document Expiry</Label>
                <Input
                  id="idDocumentExpiry"
                  type="date"
                  value={form.idDocumentExpiry}
                  onChange={onChange("idDocumentExpiry")}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-700 text-sm">
          USI details saved.
        </div>
      )}

      <CardFooter>
        <Button
          type="submit"
          form={undefined}
          onClick={(e) => {
            e.preventDefault()
            const formEl = document.querySelector("form")
            ;(formEl as HTMLFormElement)?.requestSubmit()
          }}
          className="w-full"
          disabled={submitting || !usiValid}
        >
          {submitting ? "Saving…" : "Save USI Details"}
        </Button>
        {!usiValid && (
          <p className="text-xs text-muted-foreground mt-2">
            Enter a valid 10-character USI to enable saving.
          </p>
        )}
      </CardFooter>
    </div>
  )
}
