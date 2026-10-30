/**
 * GET /api/health — liveness check
 */

import { NextResponse } from "next/server";
import { connectDb } from "@/lib/mongodb";

export async function GET() {
  try {
    await connectDb();
    return NextResponse.json({ status: "ok", db: "connected" });
  } catch {
    return NextResponse.json({ status: "ok", db: "disconnected" }, { status: 503 });
  }
}
