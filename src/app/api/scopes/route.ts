/**
 * GET /api/scopes — list qualification→RTO scopes with optional filters
 * POST /api/scopes — Super Admin creates a scope (composite key + true RTO cost)
 */

import { NextResponse } from "next/server"
import { withAuth, type AuthedRequest } from "@/middleware/auth"
import { collection, safeObjectId } from "@/lib/db"
import { isValidDate } from "@/lib/master-validation"
import type { DeliveryMode, RtoQualificationScope } from "@/lib/types"

const DELIVERY_MODES = new Set<DeliveryMode>(["RPL", "ONLINE", "CLASSROOM"])

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  )
}

export const GET = withAuth(
  async (req: AuthedRequest) => {
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] }
    if (
      !auth?.roleNames?.includes("SUPER_ADMIN") &&
      !auth?.permissions?.includes("scopes.manage")
    ) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Missing permission: scopes.manage" } },
        { status: 403 },
      )
    }

    const { searchParams } = req.nextUrl
    const qualificationId = searchParams.get("qualificationId")?.trim()
    const issuingRtoId = searchParams.get("issuingRtoId")?.trim()
    const deliveryMode = searchParams.get("deliveryMode")?.trim()
    const status = searchParams.get("status")?.trim()

    const filter: Record<string, unknown> = {}
    if (qualificationId) {
      const oid = safeObjectId(qualificationId)
      if (!oid) return invalidId()
      filter.qualificationId = oid
    }
    if (issuingRtoId) {
      const oid = safeObjectId(issuingRtoId)
      if (!oid) return invalidId()
      filter.issuingRtoId = oid
    }
    if (deliveryMode) filter.deliveryMode = deliveryMode
    if (status) filter.status = status

    const coll = await collection("rto_qualification_scopes")
    const [docs, total] = await Promise.all([
      coll.find(filter).sort({ createdAt: -1 }).toArray(),
      coll.countDocuments(filter),
    ])

    return NextResponse.json({
      items: docs.map((d: any) => ({ id: String(d._id), ...d })),
      total,
    })
  },
)

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] }
    if (!auth?.roleNames?.includes("SUPER_ADMIN")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Super Admin required." } },
        { status: 403 },
      )
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      )
    }

    const qualificationId = safeObjectId(String(body.qualificationId ?? ""))
    const issuingRtoId = safeObjectId(String(body.issuingRtoId ?? ""))
    if (!qualificationId || !issuingRtoId) return invalidId()

    const deliveryMode = String(body.deliveryMode ?? "")
    if (!DELIVERY_MODES.has(deliveryMode as DeliveryMode)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid delivery mode." } },
        { status: 400 },
      )
    }

    const trueRtoCost = Number(body.trueRtoCost)
    if (!Number.isFinite(trueRtoCost) || trueRtoCost < 0) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "True RTO cost must be a non-negative number." } },
        { status: 400 },
      )
    }

    if (!isValidDate(body.effectiveFrom)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Effective from date is required." } },
        { status: 400 },
      )
    }

    const intermediaryPartnerId = body.intermediaryPartnerId
      ? safeObjectId(String(body.intermediaryPartnerId))
      : null

    // Validate referenced records exist.
    const qColl = await collection("qualifications")
    const rColl = await collection("rtos")
    const [qual, rto] = await Promise.all([
      qColl.findOne({ _id: qualificationId }),
      rColl.findOne({ _id: issuingRtoId }),
    ])
    if (!qual) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Qualification not found." } },
        { status: 404 },
      )
    }
    if (!rto) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Issuing RTO not found." } },
        { status: 404 },
      )
    }

    const coll = await collection("rto_qualification_scopes")

    // Prevent duplicate active scope with same composite key.
    const existing = await coll.findOne({
      qualificationId,
      issuingRtoId,
      deliveryMode,
      status: "active",
      ...(intermediaryPartnerId ? { intermediaryPartnerId } : { intermediaryPartnerId: null }),
    } as any)
    if (existing) {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: "An active scope already exists for this qualification, RTO, partner and delivery mode.",
          },
        },
        { status: 409 },
      )
    }

    const now = new Date()
    const effectiveFrom = new Date(String(body.effectiveFrom))
    const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null

    const result = await coll.insertOne({
      qualificationId,
      intermediaryPartnerId,
      issuingRtoId,
      deliveryMode,
      trueRtoCost,
      currency: "AUD",
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo ? effectiveTo.toISOString() : null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as any)

    return NextResponse.json(
      { id: String(result.insertedId) },
      { status: 201 },
    )
  },
)
