"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/lib/auth"
import { getOrder } from "@/lib/ops-store"
import type { Order } from "@/lib/types"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

const STEPS = [
  { n: 1, label: "Course & Delivery" },
  { n: 2, label: "Personal & USI Verification" },
  { n: 3, label: "AVETMISS Demographics" },
  { n: 4, label: "RPL Checklist & 100-Point ID" },
  { n: 5, label: "Policies & E-Signature" },
]

const ENROLMENT_TYPES = ["Full Fee", "Government Funded", "RPL"]
const DELIVERY_MODES = ["Work Based", "RPL", "Classroom", "Online"]
const CITIZENSHIP_OPTS = ["Australian Citizen", "Permanent Resident", "New Zealand Citizen", "Temporary Visa Holder", "Other"]
const LANGUAGE_OPTS = ["English", "Mandarin", "Arabic", "Cantonese", "Vietnamese", "Greek", "Italian", "Other"]
const ENGLISH_OPTS = ["Speaks English only", "Speaks English very well", "Speaks English well", "Speaks English not well", "Speaks English not at all"]
const INDIGENOUS_OPTS = ["No", "Aboriginal", "Torres Strait Islander", "Both Aboriginal and Torres Strait Islander"]
const SCHOOL_LEVEL_OPTS = ["Year 12", "Year 11", "Year 10", "Year 9 or below", "Never attended school"]
const EMPLOYMENT_OPTS = ["Full-time employee", "Part-time employee", "Casual employee", "Self-employed", "Unemployed", "Retired", "Student"]
const STUDY_REASON_OPTS = ["To get a job", "To develop existing business", "To start own business", "To try a different career", "For personal interest", "To get a better job or promotion", "Requirement for job", "Other"]
const ID_DOCS = [
  { label: "Passport", points: 70 },
  { label: "Birth Certificate", points: 70 },
  { label: "Australian Driver's Licence", points: 40 },
  { label: "Medicare Card", points: 25 },
  { label: "Bank Statement", points: 25 },
  { label: "Utility Bill", points: 25 },
]

export default function Level2Page() {
  const { id } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const orderId = typeof id === "string" ? id : id?.[0] ?? ""

  const [order, setOrder] = useState<Order | null>(null)
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [level2Completed, setLevel2Completed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [enrolmentType, setEnrolmentType] = useState("")
  const [deliveryMode, setDeliveryMode] = useState("")
  const [creditTransfer, setCreditTransfer] = useState(false)
  const [intakeDate, setIntakeDate] = useState("")

  const [usiNumber, setUsiNumber] = useState("")
  const [usiVerified, setUsiVerified] = useState(false)
  const [legalName, setLegalName] = useState("")
  const [dob, setDob] = useState("")
  const [residentialAddress, setResidentialAddress] = useState("")
  const [postalAddress, setPostalAddress] = useState("")
  const [emergencyContactName, setEmergencyContactName] = useState("")
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("")
  const [usiApplicationAuthority, setUsiApplicationAuthority] = useState("")

  const [citizenship, setCitizenship] = useState("")
  const [countryOfBirth, setCountryOfBirth] = useState("")
  const [languageAtHome, setLanguageAtHome] = useState("")
  const [englishProficiency, setEnglishProficiency] = useState("")
  const [indigenousStatus, setIndigenousStatus] = useState("")
  const [disabilityFlags, setDisabilityFlags] = useState("")
  const [highestSchoolLevel, setHighestSchoolLevel] = useState("")
  const [priorQualifications, setPriorQualifications] = useState("")
  const [employmentStatus, setEmploymentStatus] = useState("")
  const [studyReason, setStudyReason] = useState("")

  const [academicCertificates, setAcademicCertificates] = useState(false)
  const [resume, setResume] = useState(false)
  const [refereeLetters, setRefereeLetters] = useState(false)
  const [workSamples, setWorkSamples] = useState(false)
  const [usiVetTranscript, setUsiVetTranscript] = useState(false)
  const [visaCopy, setVisaCopy] = useState(false)

  const [medicalIndemnity, setMedicalIndemnity] = useState(false)
  const [mediaConsent, setMediaConsent] = useState(false)
  const [refundPolicy, setRefundPolicy] = useState(false)
  const [ncverPrivacy, setNcverPrivacy] = useState(false)
  const [studentSignature, setStudentSignature] = useState("")
  const [signatureDate, setSignatureDate] = useState("")
  const [parentGuardianSignature, setParentGuardianSignature] = useState("")

  useEffect(() => {
    void (async () => {
      if (!orderId) return
      const o = await getOrder(orderId)
      setOrder(o ?? null)
    })()
  }, [orderId])

  const canEdit = order
    ? (user?.roleNames?.includes("CANDIDATE") && String(order.clientId) === String(user?.id)) ||
      (user?.roleNames?.includes("BDC") && String(order.bdc_id) === user?.id) ||
      (user?.roleNames?.includes("B2B_AGENT") && String(order.b2b_agent_id) === user?.id) ||
      user?.roleNames?.includes("SUPER_ADMIN") ||
      user?.roleNames?.includes("ADMIN")
    : false

  const currentStep = STEPS[step - 1]
  const progressPct = (step / STEPS.length) * 100

  async function saveStep(stepNum: number) {
    setError(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        orderId,
        step: stepNum,
        level2Completed: stepNum === STEPS.length ? level2Completed : false,
      }

      if (stepNum === 1) {
        body.enrolmentType = enrolmentType
        body.deliveryMode = deliveryMode
        body.creditTransfer = creditTransfer
        body.intakeDate = intakeDate
      } else if (stepNum === 2) {
        body.usiNumber = usiNumber
        body.usiVerified = usiVerified
        body.legalName = legalName
        body.dob = dob
        body.residentialAddress = residentialAddress
        body.postalAddress = postalAddress
        body.emergencyContactName = emergencyContactName
        body.emergencyContactPhone = emergencyContactPhone
        body.usiApplicationAuthority = usiApplicationAuthority
      } else if (stepNum === 3) {
        body.citizenship = citizenship
        body.countryOfBirth = countryOfBirth
        body.languageAtHome = languageAtHome
        body.englishProficiency = englishProficiency
        body.indigenousStatus = indigenousStatus
        body.disabilityFlags = disabilityFlags
        body.highestSchoolLevel = highestSchoolLevel
        body.priorQualifications = priorQualifications
        body.employmentStatus = employmentStatus
        body.studyReason = studyReason
      } else if (stepNum === 4) {
        body.academicCertificates = academicCertificates
        body.resume = resume
        body.refereeLetters = refereeLetters
        body.workSamples = workSamples
        body.usiVetTranscript = usiVetTranscript
        body.visaCopy = visaCopy
      } else if (stepNum === 5) {
        body.medicalIndemnity = medicalIndemnity
        body.mediaConsent = mediaConsent
        body.refundPolicy = refundPolicy
        body.ncverPrivacy = ncverPrivacy
        body.studentSignature = studentSignature
        body.signatureDate = signatureDate
        body.parentGuardianSignature = parentGuardianSignature
      }

      const res = await fetch("/api/applications/level-2", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to save step.")
        return
      }
      setSuccess(`Step ${stepNum} saved.`)

      if (stepNum < STEPS.length) {
        setStep(stepNum + 1)
      } else {
        setLevel2Completed(true)
      }
    } catch {
      setError("Could not reach the server.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!order) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
        <Skeleton className="h-10 w-48" aria-label="Loading application" />
      </div>
    )
  }

  const isCandidate = user?.roleNames?.includes("CANDIDATE")
  const channelType = order.channelType ?? ""

  const rplItems: Array<{ key: string; label: string; checked: boolean }> = [
    { key: "academicCertificates", label: "Academic Certificates", checked: academicCertificates },
    { key: "resume", label: "Resume / CV", checked: resume },
    { key: "refereeLetters", label: "Referee Letters", checked: refereeLetters },
    { key: "workSamples", label: "Work Samples / Portfolio", checked: workSamples },
    { key: "usiVetTranscript", label: "USI VET Transcript", checked: usiVetTranscript },
    { key: "visaCopy", label: "Visa Copy", checked: visaCopy },
  ]

  const policyItems: Array<{ key: string; label: string; checked: boolean }> = [
    { key: "medicalIndemnity", label: "Emergency Medical Indemnity", checked: medicalIndemnity },
    { key: "mediaConsent", label: "Media Consent", checked: mediaConsent },
    { key: "refundPolicy", label: "Refund / Cancellation Policy", checked: refundPolicy },
    { key: "ncverPrivacy", label: "NCVER Privacy Notice", checked: ncverPrivacy },
  ]

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Level 2 — AVETMISS Enrolment
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Application {order.id} · {channelType}
          </p>
        </div>
        <Badge variant={order.status === "DRAFT" ? "secondary" : "success"}>
          {order.status}
        </Badge>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>Completion</span>
          <span>{Math.round(progressPct)}%</span>
        </div>
        <div className="w-full bg-secondary/30 rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          {STEPS.map((s) => (
            <span key={s.n} className={`flex items-center gap-1 ${step === s.n ? "text-primary font-medium" : ""}`}>
              <span className={`w-5 h-5 rounded-full border flex-shrink-0 shrink-0 items-center justify-center text-[10px] ${step >= s.n ? "bg-primary text-primary-foreground" : "bg-muted border-muted text-muted-foreground"}`}>
                {step >= s.n ? "✓" : s.n}
              </span>
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step {step} of {STEPS.length} — {currentStep.label}</CardTitle>
          <CardDescription>
            Fill in the details for this step, then save and continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {step === 1 && (
            <>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="l2-enrolment">Enrolment Type</Label>
                  <select
                    id="l2-enrolment"
                    value={enrolmentType}
                    onChange={(e) => setEnrolmentType(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select enrolment type…</option>
                    {ENROLMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-delivery">Delivery Mode</Label>
                  <select
                    id="l2-delivery"
                    value={deliveryMode}
                    onChange={(e) => setDeliveryMode(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select delivery mode…</option>
                    {DELIVERY_MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-credit">Credit Transfer</Label>
                  <select
                    id="l2-credit"
                    value={creditTransfer ? "true" : "false"}
                    onChange={(e) => setCreditTransfer(e.target.value === "true")}
                    className={inputCls}
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-intake">Intake Date</Label>
                  <Input
                    id="l2-intake"
                    type="date"
                    value={intakeDate}
                    onChange={(e) => setIntakeDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="l2-legal">Legal Name</Label>
                  <Input
                    id="l2-legal"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="Full legal name"
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="l2-dob">Date of Birth</Label>
                    <Input
                      id="l2-dob"
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="l2-usi">USI Number</Label>
                    <Input
                      id="l2-usi"
                      value={usiNumber}
                      onChange={(e) => setUsiNumber(e.target.value)}
                      placeholder="1234567890"
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={usiVerified}
                      onChange={(e) => setUsiVerified(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    USI Verified
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-resaddr">Residential Address</Label>
                  <Input
                    id="l2-resaddr"
                    value={residentialAddress}
                    onChange={(e) => setResidentialAddress(e.target.value)}
                    placeholder="Street, City STATE"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-postaddr">Postal Address</Label>
                  <Input
                    id="l2-postaddr"
                    value={postalAddress}
                    onChange={(e) => setPostalAddress(e.target.value)}
                    placeholder="Same as residential…"
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="l2-ec-name">Emergency Contact Name</Label>
                    <Input
                      id="l2-ec-name"
                      value={emergencyContactName}
                      onChange={(e) => setEmergencyContactName(e.target.value)}
                      placeholder="Name"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="l2-ec-phone">Emergency Contact Phone</Label>
                    <Input
                      id="l2-ec-phone"
                      type="tel"
                      value={emergencyContactPhone}
                      onChange={(e) => setEmergencyContactPhone(e.target.value)}
                      placeholder="04xx xxx xxx"
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-usi-auth">USI Application Authority</Label>
                  <Input
                    id="l2-usi-auth"
                    value={usiApplicationAuthority}
                    onChange={(e) => setUsiApplicationAuthority(e.target.value)}
                    placeholder="Town/City of Birth"
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="l2-citizen">Citizenship / Residency</Label>
                  <select
                    id="l2-citizen"
                    value={citizenship}
                    onChange={(e) => setCitizenship(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {CITIZENSHIP_OPTS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-birth">Country of Birth</Label>
                  <Input
                    id="l2-birth"
                    value={countryOfBirth}
                    onChange={(e) => setCountryOfBirth(e.target.value)}
                    placeholder="e.g. Australia"
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="l2-lang">Language at Home</Label>
                    <select
                      id="l2-lang"
                      value={languageAtHome}
                      onChange={(e) => setLanguageAtHome(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select…</option>
                      {LANGUAGE_OPTS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="l2-english">English Proficiency</Label>
                    <select
                      id="l2-english"
                      value={englishProficiency}
                      onChange={(e) => setEnglishProficiency(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select…</option>
                      {ENGLISH_OPTS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-indigenous">Indigenous Status</Label>
                  <select
                    id="l2-indigenous"
                    value={indigenousStatus}
                    onChange={(e) => setIndigenousStatus(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {INDIGENOUS_OPTS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="l2-disability">Disability Flags</Label>
                    <Input
                      id="l2-disability"
                      value={disabilityFlags}
                      onChange={(e) => setDisabilityFlags(e.target.value)}
                      placeholder="e.g. None"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="l2-school">Highest School Level</Label>
                    <select
                      id="l2-school"
                      value={highestSchoolLevel}
                      onChange={(e) => setHighestSchoolLevel(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select…</option>
                      {SCHOOL_LEVEL_OPTS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="l2-prior">Prior Qualifications</Label>
                    <Input
                      id="l2-prior"
                      value={priorQualifications}
                      onChange={(e) => setPriorQualifications(e.target.value)}
                      placeholder="e.g. Certificate III"
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-employment">Employment Status</Label>
                  <select
                    id="l2-employment"
                    value={employmentStatus}
                    onChange={(e) => setEmploymentStatus(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {EMPLOYMENT_OPTS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-study">Study Reason</Label>
                  <select
                    id="l2-study"
                    value={studyReason}
                    onChange={(e) => setStudyReason(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {STUDY_REASON_OPTS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <Separator />
              <div className="space-y-3">
                <CardHeader>
                  <CardTitle>RPL Evidence Checklist</CardTitle>
                  <CardDescription>
                    Tick the evidence items the candidate will provide.
                  </CardDescription>
                </CardHeader>
                <div className="space-y-2">
                  {rplItems.map((item) => (
                    <div key={item.key} className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(e) => {
                          if (item.key === "academicCertificates") setAcademicCertificates(e.target.checked)
                          else if (item.key === "resume") setResume(e.target.checked)
                          else if (item.key === "refereeLetters") setRefereeLetters(e.target.checked)
                          else if (item.key === "workSamples") setWorkSamples(e.target.checked)
                          else if (item.key === "usiVetTranscript") setUsiVetTranscript(e.target.checked)
                          else setVisaCopy(e.target.checked)
                        }}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <label className="text-sm">{item.label}</label>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />
              <div className="space-y-3">
                <CardHeader>
                  <CardTitle>100-Point ID Verification</CardTitle>
                  <CardDescription>
                    Select ID documents. RECEIVED status requires 100 points.
                  </CardDescription>
                </CardHeader>
                <div className="space-y-2 max-h-60 overflow-y-auto border rounded-lg p-3">
                  {ID_DOCS.map((doc) => (
                    <div
                      key={doc.label}
                      className="flex items-center justify-between p-2 rounded hover:bg-primary/5 cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300"
                          disabled
                        />
                        <span className="text-sm">{doc.label}</span>
                      </div>
                      <Badge variant="secondary">{doc.points} pts</Badge>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Points are tracked on the candidate profile
                  <Link href={`/candidates/${order.clientId}`} className="text-primary underline-offset-4 hover:underline">
                    here
                  </Link>
                  .
                </p>
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <div className="space-y-3">
                {policyItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => {
                        if (item.key === "medicalIndemnity") setMedicalIndemnity(e.target.checked)
                        else if (item.key === "mediaConsent") setMediaConsent(e.target.checked)
                        else if (item.key === "refundPolicy") setRefundPolicy(e.target.checked)
                        else setNcverPrivacy(e.target.checked)
                      }}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <label className="text-sm">{item.label}</label>
                  </div>
                ))}
                <div className="space-y-2">
                  <Label htmlFor="l2-sig">Student Signature</Label>
                  <Input
                    id="l2-sig"
                    value={studentSignature}
                    onChange={(e) => setStudentSignature(e.target.value)}
                    placeholder="Type full name as signature"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-sig-date">Signature Date</Label>
                  <Input
                    id="l2-sig-date"
                    type="date"
                    value={signatureDate}
                    onChange={(e) => setSignatureDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="l2-parent-sig">Parent / Guardian Signature (if under 18)</Label>
                  <Input
                    id="l2-parent-sig"
                    value={parentGuardianSignature}
                    onChange={(e) => setParentGuardianSignature(e.target.value)}
                    placeholder="Optional"
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          )}

        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}
      {success && (
        <p className="text-sm text-success">{success}</p>
      )}

      <div className="flex justify-between">
        {step > 1 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep(step - 1)}
            disabled={submitting}
          >
            Previous
          </Button>
        )}
        <div className="flex items-center gap-2">
          {step < STEPS.length ? (
            <Button
              type="button"
              onClick={() => saveStep(step)}
              disabled={submitting || !canEdit}
            >
              Save & Next
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLevel2Completed(true)}
                disabled={submitting || !canEdit}
              >
                Mark Complete
              </Button>
              <Button
                type="button"
                onClick={() => saveStep(STEPS.length)}
                disabled={submitting || !canEdit}
              >
                Save & Complete
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/orders/${orderId}`)}
          >
            View Application
          </Button>
        </div>
      </div>

      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          You do not have permission to edit this application.
        </p>
      )}
    </div>
  )
}
