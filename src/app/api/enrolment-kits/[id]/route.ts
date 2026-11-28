/**
 * PATCH /api/enrolment-kits/[id] — update an enrolment kit
 * DELETE /api/enrolment-kits/[id] — delete an enrolment kit
 */

import { NextResponse } from "next/server"
import { withAuth, type AuthedRequest } from "@/middleware/auth"
import { collection, safeObjectId } from "@/lib/db"

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid kit id." } },
    { status: 400 },
  )
}

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

    const kitId = safeObjectId(resolvedParams.id)
    if (!kitId) return invalidId()

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      )
    }

    const coll = await collection("enrolment_kits")
    const existing = await coll.findOne({ _id: kitId })
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Enrolment kit not found." } },
        { status: 404 },
      )
    }

    const update: Record<string, unknown> = { updatedAt: new Date() }
    if (body.fileName !== undefined) update.fileName = String(body.fileName).trim()
    if (body.fileUrl !== undefined) update.fileUrl = String(body.fileUrl).trim()
    if (body.contentType !== undefined) update.contentType = String(body.contentType)
    if (body.sizeBytes !== undefined) update.sizeBytes = Number(body.sizeBytes)
    if (body.active !== undefined) update.active = body.active === true
    if (body.qualificationId !== undefined) {
      const oid = safeObjectId(String(body.qualificationId))
      if (!oid) return invalidId()
      update.qualificationId = oid
    }
    if (body.issuingRtoId !== undefined) {
      const oid = safeObjectId(String(body.issuingRtoId))
      if (!oid) return invalidId()
      update.issuingRtoId = oid
    }

    await coll.updateOne({ _id: kitId }, { $set: update })
    const updated = await coll.findOne({ _id: kitId })
    return NextResponse.json({ kit: { id: String(updated?._id), ...updated } })
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

    const kitId = safeObjectId(resolvedParams.id)
    if (!kitId) return invalidId()

    const coll = await collection("enrolment_kits")
    const existing = await coll.findOne({ _id: kitId })
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Enrolment kit not found." } },
        { status: 404 },
      )
    }

    await coll.deleteOne({ _id: kitId })
    return NextResponse.json({ ok: true })
  },
)
