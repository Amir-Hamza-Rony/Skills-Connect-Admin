/**
 * GET /api/scopes/[id] — get a single scope
 * PATCH /api/scopes/[id] — update a scope (Super Admin)
 * DELETE /api/scopes/[id] — delete a scope (Super Admin)
 */

import { NextResponse } from "next/server"
import { withAuth, type AuthedRequest } from "@/middleware/auth"
import { collection, safeObjectId } from "@/lib/db"
import { isValidDate } from "@/lib/master-validation"
import type { DeliveryMode, RtoQualificationScope } from "@/lib/types"

const DELIVERY_MODES = new Set<DeliveryMode>(["RPL", "ONLINE", "CLASSROOM"])

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid scope id." } },
    { status: 400 },
  )
}

export const GET = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {})
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

    const scopeId = safeObjectId(resolvedParams.id)
    if (!scopeId) return invalidId()

    const coll = await collection("rto_qualification_scopes")
    const doc = await coll.findOne({ _id: scopeId })
    if (!doc) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Scope not found." } },
        { status: 404 },
      )
    }
    return NextResponse.json({ scope: { id: String(doc._id), ...doc } })
  },
)

export const PATCH = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {})
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] }
    if (!auth?.roleNames?.includes("SUPER_ADMIN")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Super Admin required." } },
        { status: 403 },
      )
    }

    const scopeId = safeObjectId(resolvedParams.id)
    if (!scopeId) return invalidId()

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      )
    }

    const coll = await collection("rto_qualification_scopes")
    const existing = await coll.findOne({ _id: scopeId })
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Scope not found." } },
        { status: 404 },
      )
    }

    const update: Record<string, unknown> = { updatedAt: new Date() }

    if (body.deliveryMode !== undefined) {
      const mode = String(body.deliveryMode)
      if (!DELIVERY_MODES.has(mode as DeliveryMode)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid delivery mode." } },
          { status: 400 },
        )
      }
      update.deliveryMode = mode
    }
    if (body.trueRtoCost !== undefined) {
      const cost = Number(body.trueRtoCost)
      if (!Number.isFinite(cost) || cost < 0) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "True RTO cost must be a non-negative number." } },
          { status: 400 },
        )
      }
      update.trueRtoCost = cost
    }
    if (body.currency !== undefined) update.currency = String(body.currency)
    if (body.effectiveFrom !== undefined) {
      if (!isValidDate(body.effectiveFrom)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Effective from date is invalid." } },
          { status: 400 },
        )
      }
      update.effectiveFrom = new Date(String(body.effectiveFrom)).toISOString()
    }
    if (body.effectiveTo !== undefined) {
      update.effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)).toISOString() : null
    }
    if (body.status !== undefined) {
      if (!["active", "inactive"].includes(String(body.status))) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid status." } },
          { status: 400 },
        )
      }
      update.status = String(body.status)
    }
    if (body.intermediaryPartnerId !== undefined) {
      update.intermediaryPartnerId = body.intermediaryPartnerId
        ? safeObjectId(String(body.intermediaryPartnerId))
        : null
    }
    if (body.issuingRtoId !== undefined) {
      const oid = safeObjectId(String(body.issuingRtoId))
      if (!oid) return invalidId()
      update.issuingRtoId = oid
    }
    if (body.qualificationId !== undefined) {
      const oid = safeObjectId(String(body.qualificationId))
      if (!oid) return invalidId()
      update.qualificationId = oid
    }

    await coll.updateOne({ _id: scopeId }, { $set: update })
    const updated = await coll.findOne({ _id: scopeId })
    return NextResponse.json({ scope: { id: String(updated?._id), ...updated } })
  },
)

export const DELETE = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {})
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] }
    if (!auth?.roleNames?.includes("SUPER_ADMIN")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Super Admin required." } },
        { status: 403 },
      )
    }

    const scopeId = safeObjectId(resolvedParams.id)
    if (!scopeId) return invalidId()

    const coll = await collection("rto_qualification_scopes")
    const existing = await coll.findOne({ _id: scopeId })
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Scope not found." } },
        { status: 404 },
      )
    }

    await coll.deleteOne({ _id: scopeId })
    return NextResponse.json({ ok: true })
  },
)
