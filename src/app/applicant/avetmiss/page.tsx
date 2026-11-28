"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronRight, CheckCircle2, AlertCircle, Clock, FileText, RefreshCw } from "lucide-react"
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
 * AVETMISS 5-Step Enrolment Form (/applicant/avetmiss).
 *
 * Step 1 — Course & Delivery
 * Step 2 — Personal & USI Verification
 * Step 3 — AVETMISS Demographics
 * Step 4 — RPL Checklist & Live 100-Point ID Vault
 * Step 5 — Policies & Digital E-Signature
 * (docs v5.1 §2 Module 3 Step B)
 */

const STEPS = [
  { id: 1, title: "Course & Delivery" },
  { id: 2, title: "Personal & USI" },
  { id: 3, title: "AVETMISS Demographics" },
  { id: 4, title: "RPL Evidence Checklist" },
  { id: 5, title: "Policies & E-Signature" },
]

interface FormData {
  step1: {
    enrolmentType: "RPL" | "Full Fee" | "Government Funded"
    deliveryMode: "Work Based / RPL" | "Classroom" | "Online"
    creditTransfer: "Yes" | "No"
    intakeDate: string
  }
  step2: {
    usiNumber: string
    legalName: string
    dob: string
    residentialAddress: string
    postalAddress: string
    emergencyContactName: string
    emergencyContactPhone: string
  }
  step3: {
    citizenship: string
    countryOfBirth: string
    languageAtHome: string
    englishProficiency: string
    indigenousStatus: string
    disabilityFlags: string
    highestSchoolLevel: string
    priorQualifications: string
    employmentStatus: string
    studyReason: string
  }
  step4: {
    academicCertificates: boolean
    resume: boolean
    refereeLetters: boolean
    workSamples: boolean
    usiVetTranscript: boolean
    visaCopy: boolean
  }
  step5: {
    medicalIndemnity: boolean
    mediaConsent: boolean
    refundPolicy: boolean
    ncverPrivacy: boolean
    studentSignature: string
    signatureDate: string
    parentGuardianSignature?: string
  }
}

const EMPTY: FormData = {
  step1: { enrolmentType: "RPL", deliveryMode: "Work Based / RPL", creditTransfer: "No", intakeDate: "" },
  step2: { usiNumber: "", legalName: "", dob: "", residentialAddress: "", postalAddress: "", emergencyContactName: "", emergencyContactPhone: "" },
  step3: { citizenship: "", countryOfBirth: "", languageAtHome: "", englishProficiency: "", indigenousStatus: "", disabilityFlags: "", highestSchoolLevel: "", priorQualifications: "", employmentStatus: "", studyReason: "" },
  step4: { academicCertificates: false, resume: false, refereeLetters: false, workSamples: false, usiVetTranscript: false, visaCopy: false },
  step5: { medicalIndemnity: false, mediaConsent: false, refundPolicy: false, ncverPrivacy: false, studentSignature: "", signatureDate: "", parentGuardianSignature: "" },
}

export default function AvetmissPage() {
  const { user } = useAuth()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await api.get<{ items: any[] }>(`/applications?clientId=${user?.id}`)
        const app = (data.items ?? [])[0]
        if (app) {
          setForm((prev) => ({
            ...prev,
            step1: {
              ...prev.step1,
              enrolmentType: app.enrolmentType ?? prev.step1.enrolmentType,
              deliveryMode: app.deliveryMode ?? prev.step1.deliveryMode,
              creditTransfer: app.creditTransfer ?? prev.step1.creditTransfer,
              intakeDate: app.intakeDate ?? prev.step1.intakeDate,
            },
            step2: {
              ...prev.step2,
              usiNumber: app.usiNumber ?? "",
              legalName: app.legalName ?? "",
              dob: app.dob ?? "",
              residentialAddress: app.residentialAddress ?? "",
              postalAddress: app.postalAddress ?? "",
              emergencyContactName: app.emergencyContactName ?? "",
              emergencyContactPhone: app.emergencyContactPhone ?? "",
            },
          }))
          if (app.level2Completed) setCompletedSteps(new Set([2]))
        }
      } catch {
        // Ignore
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const onChange = useCallback(
    (stepId: number, field: string, value: string | boolean) => {
      setForm((prev) => ({
        ...prev,
        [`step${stepId}` as keyof FormData]: {
          ...prev[`step${stepId}` as keyof FormData],
          [field]: value,
        } as any,
      }))
      setError(null)
    },
    [],
  )

  const isStepComplete = (s: number): boolean => {
    if (completedSteps.has(s)) return true
    const f = form[`step${s}` as keyof FormData] as Record<string, unknown>
    return Object.values(f).every((v) => v !== "" && v !== false && v !== null && v !== undefined)
  }

  const canProceed = isStepComplete(step)

  const progress = ((step - 1) / (STEPS.length - 1)) * 100

  async function onSave(e: React.FormEvent) {
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
          step,
          ...form,
          level2Completed: step === 5,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error?.message ?? "Save failed.")
        return
      }
      setCompletedSteps((prev) => new Set([...prev, step]))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      if (step < STEPS.length) setStep((s) => s + 1)
    } catch {
      setError("Save failed. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Enrolment Form</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Level 2 statutory AVETMISS & RPL evidence — 5 steps. Save and return anytime.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="text-muted-foreground">Step {step} of {STEPS.length}</span>
        </div>
      </div>

      <div className="h-1 w-full rounded-full bg-border/50 overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex gap-2 text-xs text-muted-foreground mb-4">
        {STEPS.map((s) => (
          <div key={s.id} className="flex items-center gap-1">
            {s.id < step && <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden />}
            {s.id === step && <Clock className="h-3 w-3 text-primary" aria-hidden />}
            <span className={s.id === step ? "font-semibold text-foreground" : "text-muted-foreground"}>
              {s.title}
            </span>
            {s.id < STEPS.length && <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />}
          </div>
        ))}
      </div>

      <form onSubmit={onSave} className="space-y-4" noValidate={false}>
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Step 1 — Course & Delivery</CardTitle>
              <CardDescription className="text-xs">Select your enrolment type, delivery mode and intake.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="enrolmentType">Enrolment Type</Label>
                <select
                  id="enrolmentType"
                  value={form.step1.enrolmentType}
                  onChange={(e) => onChange(1, "enrolmentType", e.target.value as any)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="RPL">Recognition of Prior Learning (RPL)</option>
                  <option value="Full Fee">Full Fee</option>
                  <option value="Government Funded">Government Funded</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deliveryMode">Delivery Mode</Label>
                <select
                  id="deliveryMode"
                  value={form.step1.deliveryMode}
                  onChange={(e) => onChange(1, "deliveryMode", e.target.value as any)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="Work Based / RPL">Work Based / RPL</option>
                  <option value="Classroom">Classroom</option>
                  <option value="Online">Online</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="creditTransfer">Credit Transfer</Label>
                <select
                  id="creditTransfer"
                  value={form.step1.creditTransfer}
                  onChange={(e) => onChange(1, "creditTransfer", e.target.value as any)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intakeDate">Intake Date</Label>
                <Input
                  id="intakeDate"
                  type="date"
                  value={form.step1.intakeDate}
                  onChange={(e) => onChange(1, "intakeDate", e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Step 2 — Personal & USI Verification</CardTitle>
              <CardDescription className="text-xs">Legal name, DOB, addresses, emergency contact and USI.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="legalName">Legal Given Names</Label>
                  <Input
                    id="legalName"
                    value={form.step2.legalName}
                    onChange={(e) => onChange(2, "legalName", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="familyName">Family Name</Label>
                  <Input
                    id="familyName"
                    value={form.step2.legalName}
                    onChange={(e) => onChange(2, "legalName", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dob">Date of Birth</Label>
                  <Input
                    id="dob"
                    type="date"
                    value={form.step2.dob}
                    onChange={(e) => onChange(2, "dob", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="usiNumber">USI Number</Label>
                  <Input
                    id="usiNumber"
                    maxLength={10}
                    value={form.step2.usiNumber}
                    onChange={(e) => onChange(2, "usiNumber", e.target.value.toUpperCase())}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring text-uppercase"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="residentialAddress">Residential Address (non-PO Box)</Label>
                <Input
                  id="residentialAddress"
                  value={form.step2.residentialAddress}
                  onChange={(e) => onChange(2, "residentialAddress", e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="postalAddress">Postal Address</Label>
                <Input
                  id="postalAddress"
                  value={form.step2.postalAddress}
                  onChange={(e) => onChange(2, "postalAddress", e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="emergencyContactName">Emergency Contact Name</Label>
                  <Input
                    id="emergencyContactName"
                    value={form.step2.emergencyContactName}
                    onChange={(e) => onChange(2, "emergencyContactName", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emergencyContactPhone">Emergency Contact Phone</Label>
                  <Input
                    id="emergencyContactPhone"
                    type="tel"
                    value={form.step2.emergencyContactPhone}
                    onChange={(e) => onChange(2, "emergencyContactPhone", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Step 3 — AVETMISS Demographics</CardTitle>
              <CardDescription className="text-xs">Citizenship, residency, language, indigenous status and employment.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="citizenship">Citizenship / Residency</Label>
                  <Input
                    id="citizenship"
                    value={form.step3.citizenship}
                    onChange={(e) => onChange(3, "citizenship", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="countryOfBirth">Country of Birth</Label>
                  <Input
                    id="countryOfBirth"
                    value={form.step3.countryOfBirth}
                    onChange={(e) => onChange(3, "countryOfBirth", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="languageAtHome">Language at Home</Label>
                  <Input
                    id="languageAtHome"
                    value={form.step3.languageAtHome}
                    onChange={(e) => onChange(3, "languageAtHome", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="englishProficiency">English Proficiency</Label>
                  <Input
                    id="englishProficiency"
                    value={form.step3.englishProficiency}
                    onChange={(e) => onChange(3, "englishProficiency", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="indigenousStatus">Indigenous Status</Label>
                  <Input
                    id="indigenousStatus"
                    value={form.step3.indigenousStatus}
                    onChange={(e) => onChange(3, "indigenousStatus", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="disabilityFlags">Disability Flags</Label>
                  <Input
                    id="disabilityFlags"
                    value={form.step3.disabilityFlags}
                    onChange={(e) => onChange(3, "disabilityFlags", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="highestSchoolLevel">Highest School Level</Label>
                  <Input
                    id="highestSchoolLevel"
                    value={form.step3.highestSchoolLevel}
                    onChange={(e) => onChange(3, "highestSchoolLevel", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="priorQualifications">Prior Qualifications</Label>
                  <Input
                    id="priorQualifications"
                    value={form.step3.priorQualifications}
                    onChange={(e) => onChange(3, "priorQualifications", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="employmentStatus">Employment Status</Label>
                  <Input
                    id="employmentStatus"
                    value={form.step3.employmentStatus}
                    onChange={(e) => onChange(3, "employmentStatus", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="studyReason">Study Reason</Label>
                  <Input
                    id="studyReason"
                    value={form.step3.studyReason}
                    onChange={(e) => onChange(3, "studyReason", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Step 4 — RPL Evidence Checklist</CardTitle>
              <CardDescription className="text-xs">Upload the evidence required for RPL assessment.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {[{
                  id: "academicCertificates",
                  label: "Academic Certificates",
                  desc: "Previous qualifications and transcripts.",
                }, {
                  id: "resume",
                  label: "Resume (2+ years industry experience)",
                  desc: "Demonstrating at least two years of industry experience.",
                }, {
                  id: "refereeLetters",
                  label: "Referee Letters",
                  desc: "2 referee letters, or 1 letter signed by 2 referees.",
                }, {
                  id: "workSamples",
                  label: "Work Samples / Portfolio",
                  desc: "Plus work photos and videos for trade courses.",
                }, {
                  id: "usiVetTranscript",
                  label: "USI VET Transcript",
                  desc: "Your national VET training record.",
                }, {
                  id: "visaCopy",
                  label: "Visa Copy",
                  desc: "Exempt for Australian Citizens and offshore applicants.",
                }].map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-border/60">
                    <div className="flex items-center gap-3">
                      <input
                        id={item.id}
                        type="checkbox"
                        checked={form.step4[item.id as keyof FormData["step4"]] as boolean}
                        onChange={(e) => onChange(4, item.id, e.target.checked)}
                        className="rounded border-input bg-background text-primary focus:ring-primary"
                      />
                      <div>
                        <Label htmlFor={item.id} className="text-sm font-medium block">
                          {item.label}
                        </Label>
                        <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                    {(form.step4[item.id as keyof FormData["step4"]] as boolean) && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                All mandatory evidence must be uploaded before the application can move to RECEIVED status.
              </p>
            </CardContent>
          </Card>
        )}

        {step === 5 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Step 5 — Policies & Digital E-Signature</CardTitle>
              <CardDescription className="text-xs">Acknowledge policies and sign electronically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {[{
                  id: "medicalIndemnity",
                  label: "Emergency Medical Indemnity",
                  desc: "I acknowledge the emergency medical indemnity policy.",
                }, {
                  id: "mediaConsent",
                  label: "Media Consent",
                  desc: "I consent to the use of my image and story for promotional purposes.",
                }, {
                  id: "refundPolicy",
                  label: "Refund / Cancellation Policy",
                  desc: "I acknowledge the refund and cancellation policy.",
                }, {
                  id: "ncverPrivacy",
                  label: "NCVER Privacy Notice",
                  desc: "I consent to NCVER privacy notice data collection.",
                }].map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-border/60">
                    <div className="flex items-center gap-3">
                      <input
                        id={item.id}
                        type="checkbox"
                        checked={form.step5[item.id as keyof FormData["step5"]] as boolean}
                        onChange={(e) => onChange(5, item.id, e.target.checked)}
                        className="rounded border-input bg-background text-primary focus:ring-primary"
                      />
                      <div>
                        <Label htmlFor={item.id} className="text-sm font-medium block">
                          {item.label}
                        </Label>
                        <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                    {(form.step5[item.id as keyof FormData["step5"]] as boolean) && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                    )}
                  </div>
                ))}
              </div>
              <Separator />
              <div className="space-y-1.5">
                <Label htmlFor="studentSignature">Electronic Student Signature</Label>
                <Input
                  id="studentSignature"
                  value={form.step5.studentSignature}
                  onChange={(e) => onChange(5, "studentSignature", e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signatureDate">Date</Label>
                <Input
                  id="signatureDate"
                  type="date"
                  value={form.step5.signatureDate}
                  onChange={(e) => onChange(5, "signatureDate", e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                If under 18, a parent/guardian signature is also required.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="parentGuardianSignature">Parent / Guardian Signature (if under 18)</Label>
                <Input
                  id="parentGuardianSignature"
                  value={form.step5.parentGuardianSignature ?? ""}
                  onChange={(e) => onChange(5, "parentGuardianSignature", e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
            {error}
          </div>
        )}
        {saved && (
          <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-700 text-sm">
            Step {step} saved.
          </div>
        )}

        <CardFooter className="flex items-center justify-between">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((s) => s - 1)}
              disabled={submitting}
            >
              <ChevronRight className="-ml-1 h-4 w-4 rotate-180" aria-hidden /> Previous
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {canProceed ? "Ready to save" : "Complete all fields to continue"}
          </span>
          <Button
            type="submit"
            className="ml-2"
            disabled={submitting || !canProceed}
          >
            {submitting ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : step === 5 ? (
              "Complete Enrolment"
            ) : (
              `Next: ${STEPS[step].title}`
            )}
          </Button>
        </CardFooter>
      </form>
    </div>
  )
}
