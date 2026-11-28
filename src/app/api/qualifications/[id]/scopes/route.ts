/**
 * GET /api/qualifications/[id]/scopes — list scopes for a qualification
 */

import { NextResponse } from "next/server"
import { withAuth, type AuthedRequest } from "@/middleware/auth"
import { collection, safeObjectId } from "@/lib/db"

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid qualification id." } },
    { status: 400 },
  )
}

export const GET = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {})
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] }
    if (
      !auth?.roleNames?.includes("SUPER_ADMIN") &&
      !auth?.permissions?.includes("scopes.manage") &&
      !auth?.permissions?.includes("qualifications.manage")
    ) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Missing permission." } },
        { status: 403 },
      )
    }

    const qualificationId = safeObjectId(resolvedParams.id)
    if (!qualificationId) return invalidId()

    const coll = await collection("rto_qualification_scopes")
    const docs = await coll
      .find({ qualificationId, status: "active" })
      .sort({ createdAt: -1 })
      .toArray()

    return NextResponse.json({
      items: docs.map((d: any) => ({ id: String(d._id), ...d })),
    })
  },
)
