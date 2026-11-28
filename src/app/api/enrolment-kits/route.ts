/**
 * GET /api/enrolment-kits — list enrolment kits with optional filters
 * POST /api/enrolment-kits — create an enrolment kit
 */

import { NextResponse } from "next/server"
import { withAuth, type AuthedRequest } from "@/middleware/auth"
import { collection, safeObjectId } from "@/lib/db"
import type { EnrolmentKit } from "@/lib/types"

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
      !auth?.permissions?.includes("scopes.manage") &&
      !auth?.permissions?.includes("qualifications.manage") &&
      !auth?.permissions?.includes("rto.manage")
    ) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Missing permission." } },
        { status: 403 },
      )
    }

    const { searchParams } = req.nextUrl
    const qualificationId = searchParams.get("qualificationId")?.trim()
    const issuingRtoId = searchParams.get("issuingRtoId")?.trim()
    const active = searchParams.get("active")?.trim()

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
    if (active !== "") filter.active = active === "true"

    const coll = await collection("enrolment_kits")
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

    const fileName = String(body.fileName ?? "").trim()
    const fileUrl = String(body.fileUrl ?? "").trim()
    const contentType = String(body.contentType ?? "application/octet-stream")
    const sizeBytes = Number(body.sizeBytes ?? 0)
    if (!fileName || !fileUrl) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "fileName and fileUrl are required." } },
        { status: 400 },
      )
    }

    const coll = await collection("enrolment_kits")
    const now = new Date()
    const result = await coll.insertOne({
      qualificationId,
      issuingRtoId,
      fileName,
      fileUrl,
      contentType,
      sizeBytes,
      active: body.active !== false,
      createdAt: now,
      updatedAt: now,
    } as any)

    return NextResponse.json({ id: String(result.insertedId) }, { status: 201 })
  },
)
