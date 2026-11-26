/**
 * GET /api/users — list users (requires users.manage)
 * POST /api/users — create user (requires users.manage)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { hashPassword } from "@/lib/api-auth";
import { resolvePrimaryRole } from "@/lib/permissions";
import { generateDemoContact } from "@/lib/demo-contact";

export const GET = withAuth("users.manage",
  async (req) => {
    const users = await collection("users");
    const docs = await users.find({}, { projection: { passwordHash: 0, passwordSalt: 0 } }).sort({ name: 1 }).toArray();
    return NextResponse.json({
      users: docs.map((u: any) => ({
        id: String(u._id),
        name: u.name,
        full_name: u.full_name ?? u.name,
        email: u.email,
        phone: u.phone,
        role: resolvePrimaryRole(u),
        roleNames: u.roleNames ?? [],
        agency_name: u.agency_name ?? null,
        b2b_tier: u.b2b_tier ?? "SILVER",
        default_commission_pct: u.default_commission_pct ?? 0,
        active: u.active,
        is_active: u.active,
        lastLoginAt: u.lastLoginAt ?? null,
      })),
    });
  },
);

export const POST = withAuth("users.manage",
  async (req) => {
    const { email, name, phone, password, role, roleNames, agency_name, b2b_tier, default_commission_pct, active } = await req.json();
    if (!email || !name || !password || !role) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing required fields: email, name, password, role." } }, { status: 400 });
    }

    const users = await collection("users");
    if (await users.findOne({ email: email.toLowerCase() })) {
      return NextResponse.json({ error: { code: "CONFLICT", message: "Email already exists." } }, { status: 409 });
    }

    const { hash } = await hashPassword(password);
    const now = new Date();
    const roleNamesArray = roleNames && Array.isArray(roleNames) ? roleNames : [role];
    // Keep the legacy scalar consistent with the authoritative role list so
    // new accounts cannot reproduce the ADMIN/B2B_AGENT label drift.
    const primaryRole = resolvePrimaryRole({ role, roleNames: roleNamesArray });
    if (!primaryRole) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "At least one valid role is required." } },
        { status: 400 },
      );
    }
    const result = await users.insertOne({
      email: email.toLowerCase(),
      name,
      full_name: name,
      phone: phone ? String(phone).trim() : generateDemoContact(name),
      passwordHash: hash,
      role: primaryRole,
      roleNames: roleNamesArray,
      agency_name: agency_name ?? null,
      b2b_tier: b2b_tier ?? "SILVER",
      default_commission_pct: default_commission_pct ?? 0,
      active: active !== false,
      is_active: active !== false,
      createdAt: now,
      updatedAt: now,
      failedLoginCount: 0,
    });

    return NextResponse.json({
      user: {
        id: String(result.insertedId),
        name,
        full_name: name,
        email: email.toLowerCase(),
        phone: phone ? String(phone).trim() : generateDemoContact(name),
        role: primaryRole,
        roleNames: roleNamesArray,
        agency_name: agency_name ?? null,
        b2b_tier: b2b_tier ?? "SILVER",
        default_commission_pct: default_commission_pct ?? 0,
        active: active !== false,
      },
    }, { status: 201 });
  },
);
