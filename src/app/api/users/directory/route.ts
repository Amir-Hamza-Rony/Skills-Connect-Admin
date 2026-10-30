/**
 * GET /api/users/directory — name-only staff list for resolving actor ids to display names.
 * Deliberately reachable by ANY signed-in user (no users.manage required).
 * Returns id + name only — no email, phone, roles, or lockout state.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth(
  async (req) => {
    const users = await collection("users");
    const staff = await users.find({}, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
    return NextResponse.json({ users: staff.map((s: any) => ({ id: String(s._id), name: s.name })) });
  },
);