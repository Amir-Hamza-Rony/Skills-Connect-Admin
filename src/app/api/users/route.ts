/**
 * GET /api/users — list users (requires users.manage)
 * POST /api/users — create user (requires users.manage)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { hashPassword } from "@/lib/api-auth";

export const GET = withAuth("users.manage",
  async (req) => {
    const users = await collection("users");
    const docs = await users.find({}, { projection: { passwordHash: 0, passwordSalt: 0 } }).sort({ name: 1 }).toArray();
    return NextResponse.json({
      users: docs.map((u: any) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        phone: u.phone,
        active: u.active,
        roleNames: u.roleNames ?? [],
        lastLoginAt: u.lastLoginAt ?? null,
      })),
    });
  },
);

export const POST = withAuth("users.manage",
  async (req) => {
    const { email, name, phone, password, roleNames } = await req.json();
    if (!email || !name || !password || !roleNames?.length) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing required fields." } }, { status: 400 });
    }

    const users = await collection("users");
    if (await users.findOne({ email: email.toLowerCase() })) {
      return NextResponse.json({ error: { code: "CONFLICT", message: "Email already exists." } }, { status: 409 });
    }

    const { hash } = await hashPassword(password);
    const now = new Date();
    const result = await users.insertOne({
      email: email.toLowerCase(),
      name,
      phone: phone ?? "",
      passwordHash: hash,
      roleNames,
      active: true,
      createdAt: now,
      updatedAt: now,
      failedLoginCount: 0,
    });

    return NextResponse.json({
      user: {
        id: String(result.insertedId),
        name,
        email: email.toLowerCase(),
        phone: phone ?? "",
        active: true,
        roleNames,
      },
    }, { status: 201 });
  },
);