/**
 * GET /api/roles — list roles
 * POST /api/roles — create role
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("users.manage",
  async (req) => {
    const roles = await collection("roles");
    const docs = await roles.find().sort({ name: 1 }).toArray();
    return NextResponse.json({ roles: docs.map((r: any) => ({ id: String(r._id), name: r.name, permissions: r.permissions })) });
  },
);

export const POST = withAuth("users.manage",
  async (req) => {
    const { name, permissions } = await req.json();
    if (!name || !Array.isArray(permissions)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Name and permissions required." } }, { status: 400 });
    }
    const result = await (await collection("roles")).insertOne({ name, permissions, createdAt: new Date() });
    return NextResponse.json({ id: String(result.insertedId), name, permissions }, { status: 201 });
  },
);