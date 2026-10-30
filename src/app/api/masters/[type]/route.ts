/**
 * GET /api/masters/[type] — list masters
 * POST /api/masters/[type] — create master
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

const PERMISSION_MAP: Record<string, string> = {
  qualifications: "qualifications.manage",
  rtos: "rto.manage",
  agents: "agents.manage",
  "supplier-routes": "pricing.manage",
};

async function checkPerm(auth: { roleNames?: string[]; permissions?: string[] }, perm: string): Promise<boolean> {
  if (auth?.roleNames?.includes("Super Admin")) return true;
  return auth?.permissions?.includes(perm) ?? false;
}

export const GET = withAuth(async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
  const resolvedParams = await (params ?? {});
  const { type } = resolvedParams;
  const perm = PERMISSION_MAP[String(type)];
  if (!perm) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown master type." } }, { status: 404 });
  const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
  if (!(await checkPerm(auth, perm))) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${perm}` } }, { status: 403 });
  }
  const coll = await collection(String(type));
  const docs = await coll.find().sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ items: docs.map((d: any) => ({ id: String(d._id), ...d })) });
});

export const POST = withAuth(async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
  const resolvedParams = await (params ?? {});
  const { type } = resolvedParams;
  const perm = PERMISSION_MAP[String(type)];
  if (!perm) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown master type." } }, { status: 404 });
  const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
  if (!(await checkPerm(auth, perm))) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${perm}` } }, { status: 403 });
  }
  const body = await req.json();
  const coll = await collection(String(type));
  const result = await coll.insertOne({ ...body, createdAt: new Date(), updatedAt: new Date() });
  return NextResponse.json({ id: String(result.insertedId), ...body }, { status: 201 });
});