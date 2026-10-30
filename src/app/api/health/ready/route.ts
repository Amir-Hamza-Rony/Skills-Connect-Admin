/**
 * GET /api/health/ready — readiness. 503 until the database is reachable.
 * Mirrors Express `GET /health/ready`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const GET = async (req: NextRequest) => {
  try {
    const db = await getDb();
    // Ping the database to confirm it is actually reachable.
    await db.command({ ping: 1 });
    return NextResponse.json({ status: "ready", service: "skills-connect-admin-api", db: "connected" });
  } catch {
    return NextResponse.json(
      { status: "not_ready", service: "skills-connect-admin-api", db: "disconnected" },
      { status: 503 },
    );
  }
};
