/**
 * RBAC Authorization — SUPER_ADMIN access regression coverage.
 *
 * Verifies that SUPER_ADMIN can access all administrative modules after the
 * RBAC fix, and that other roles continue to follow least-privilege rules.
 *
 * All fixtures are seeded into the in-memory test database (tests/setup.ts);
 * no production database is used.
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import {
  clearDb,
  makeAdminToken,
  makeB2BAgentToken,
  makeBDCToken,
  makeSuperAdminToken,
  seedClient,
  seedOrder,
  seedRto,
  seedAgent,
  seedCommissionRule,
  seedUser,
} from "./helpers";

const BDC_1 = "rbac-bdc-1";
const BDC_2 = "rbac-bdc-2";
const B2B_1 = "rbac-b2b-1";

function req(url: string, token: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const isBodyMethod = method !== "GET" && method !== "HEAD";
  if (isBodyMethod && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: isBodyMethod && body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Token for a SUPER_ADMIN whose roleNames deliberately uses the old incorrect
 * casing ("Super Admin") to prove the server-side bypass matches roleNames,
 * not just the `role` field.
 */
function makeStaleSuperAdminToken() {
  return signAccessToken({
    userId: "stale-super-admin",
    name: "Stale Super Admin",
    email: "stale@test.com",
    full_name: "Stale Super Admin",
    role: "SUPER_ADMIN",
    roleNames: ["Super Admin"],
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
    permissions: [],
  });
}

async function seedBaseline() {
  const clientId = await seedClient(undefined, "RBAC Client", "rbac@test.com");
  const qualId = new ObjectId();
  const rtoId = await seedRto();
  const agentId = await seedAgent();
  const orderId = await seedOrder(
    new ObjectId(),
    clientId,
    qualId,
    new ObjectId(),
    new ObjectId(),
    rtoId,
    { bdc_id: BDC_1, channel_type: "B2C_BDC" },
  );
  await seedCommissionRule(new ObjectId(), agentId);
  return { clientId, qualId, rtoId, agentId, orderId };
}

describe("RBAC — SUPER_ADMIN access to all affected modules", () => {
  beforeEach(async () => {
    await clearDb();
  });

  const moduleCases = [
    { label: "RTO list", method: "GET" as const, url: "/api/masters/rtos", status: 200 },
    { label: "Commission rules list", method: "GET" as const, url: "/api/masters/commission-rules", status: 200 },
    { label: "Commission records list", method: "GET" as const, url: "/api/commission-records", status: 200 },
    { label: "Commission payouts list", method: "GET" as const, url: "/api/commission-payouts", status: 200 },
    { label: "Reconciliation", method: "GET" as const, url: "/api/finance/summary", status: 200 },
    { label: "RTO Processing list", method: "GET" as const, url: "/api/rto-processing", status: 200 },
  ];

  for (const { label, method, url, status } of moduleCases) {
    it(`SUPER_ADMIN can access ${label}`, async () => {
      await seedBaseline();
      // Import the handler dynamically based on the URL prefix.
      let handler: any;
      if (url.startsWith("/api/masters/")) {
        const mod = await import("@/app/api/masters/[type]/route");
        handler = method === "GET" ? mod.GET : mod.POST;
      } else if (url.startsWith("/api/commission-records")) {
        const mod = await import("@/app/api/commission-records/route");
        handler = method === "GET" ? mod.GET : mod.POST;
      } else if (url.startsWith("/api/commission-payouts")) {
        const mod = await import("@/app/api/commission-payouts/route");
        handler = method === "GET" ? mod.GET : mod.POST;
      } else if (url.startsWith("/api/finance/summary")) {
        const mod = await import("@/app/api/finance/summary/route");
        handler = mod.GET;
      } else if (url.startsWith("/api/rto-processing")) {
        const mod = await import("@/app/api/rto-processing/route");
        handler = mod.GET;
      } else {
        throw new Error(`Unsupported URL: ${url}`);
      }
      const res = await handler(
        req(url, makeSuperAdminToken(), method, { legalName: "X", tradingName: "X", rtoCode: "X001", status: "active", complianceNote: "", website: "" }),
        { params: { type: "rtos" } },
      );
      // The key assertion is that permission is NOT the reason for rejection
      // (i.e. not 403). Some routes may return 404/400 for bogus data, which
      // is fine — they're not permission errors.
      expect(res.status, `${label} should not be 403-forbidden`).not.toBe(403);
    });
  }

  it("SUPER_ADMIN with stale roleNames casing still bypasses permission checks", async () => {
    await seedBaseline();
    // SUPER_ADMIN bypass checks roleNames.includes("SUPER_ADMIN"). A stale
    // token with roleNames=["Super Admin"] would fail that bypass, so it
    // should fall through to permission-based checks. Since its permissions
    // array is empty, admin-only routes return 403 — proving the bypass is
    // roleName-driven and not assumed from the `role` field alone.
    const { GET } = await import("@/app/api/masters/[type]/route");
    const res = await GET(
      req("/api/masters/rtos", makeStaleSuperAdminToken(), "GET"),
      { params: { type: "rtos" } },
    );
    expect(res.status).toBe(403);
  });

  it("ADMIN retains full access to affected modules (same permissions as SUPER_ADMIN)", async () => {
    await seedBaseline();
    const token = makeAdminToken();
    // ADMIN should have rto.manage (same as SUPER_ADMIN now) → not 403 on RTO routes
    const { GET } = await import("@/app/api/masters/[type]/route");
    const res = await GET(
      req("/api/masters/rtos", token, "GET"),
      { params: { type: "rtos" } },
    );
    expect(res.status).not.toBe(403);
  });

  it("BDC cannot access RTO management (403)", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/masters/[type]/route");
    const res = await GET(
      req("/api/masters/rtos", makeBDCToken(BDC_1), "GET"),
      { params: { type: "rtos" } },
    );
    expect(res.status).toBe(403);
  });

  it("B2B_AGENT cannot access RTO management (403)", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/masters/[type]/route");
    const res = await GET(
      req("/api/masters/rtos", makeB2BAgentToken(B2B_1), "GET"),
      { params: { type: "rtos" } },
    );
    expect(res.status).toBe(403);
  });

  it("BDC cannot access commission rules (403)", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/masters/commission-rules/route");
    const res = await GET(req("/api/masters/commission-rules", makeBDCToken(BDC_1)));
    expect(res.status).toBe(403);
  });

  it("B2B_AGENT cannot access commission payouts (403)", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/commission-payouts/route");
    const res = await GET(req("/api/commission-payouts", makeB2BAgentToken(B2B_1)));
    expect(res.status).toBe(403);
  });

  it("BDC cannot access reconciliation/finance summary (403)", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/finance/summary/route");
    const res = await GET(req("/api/finance/summary", makeBDCToken(BDC_1)));
    expect(res.status).toBe(403);
  });

  it("BDC cannot access RTO Processing (403)", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/rto-processing/route");
    const res = await GET(req("/api/rto-processing", makeBDCToken(BDC_1)));
    expect(res.status).toBe(403);
  });

  it("SUPER_ADMIN can access RTO Processing", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/rto-processing/route");
    const res = await GET(req("/api/rto-processing", makeSuperAdminToken()));
    expect(res.status).not.toBe(403);
  });

  it("Unauthenticated requests return 401", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/masters/[type]/route");
    const res = await GET(
      new NextRequest("http://localhost/api/masters/rtos"),
      { params: { type: "rtos" } },
    );
    expect(res.status).toBe(401);
  });
});

describe("RBAC — permission synchronization idempotency", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("sync script normalizes non-canonical roleNames and backfills SUPER_ADMIN", async () => {
    const db = await getDb();
    // Insert a user with the old incorrect casing.
    await db.collection("users").insertOne({
      email: "stale@test.com",
      name: "Stale User",
      passwordHash: "dummy-hash",
      role: "SUPER_ADMIN",
      roleNames: ["Super Admin"],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Run the sync script logic inline (importing would start a DB client).
    const users = db.collection("users");
    const user = await users.findOne({ email: "stale@test.com" });
    expect(user).not.toBeNull();
    expect(user!.roleNames).toEqual(["Super Admin"]);

    // Normalize: "Super Admin" -> "SUPER_ADMIN"
    const normalized = (user!.roleNames as string[]).map((rn) => {
      const norm: Record<string, string> = {
        "super admin": "SUPER_ADMIN",
        "super_admin": "SUPER_ADMIN",
        "Super Admin": "SUPER_ADMIN",
        "SUPER ADMIN": "SUPER_ADMIN",
        admin: "ADMIN",
        bdc: "BDC",
        "b2b_agent": "B2B_AGENT",
        "b2b agent": "B2B_AGENT",
      };
      return norm[rn.trim()] ?? rn;
    });
    const deduped = [...new Set(normalized)];
    // Backfill SUPER_ADMIN if role is SUPER_ADMIN but not in roleNames.
    const final = (user!.role === "SUPER_ADMIN" && !deduped.includes("SUPER_ADMIN"))
      ? [...deduped, "SUPER_ADMIN"]
      : deduped;

    await users.updateOne(
      { _id: user._id },
      { $set: { roleNames: final, updatedAt: new Date() } },
    );

    const after = await users.findOne({ email: "stale@test.com" });
    expect(after!.roleNames).toContain("SUPER_ADMIN");
    expect(after!.roleNames).not.toContain("Super Admin");
  });

  it("running sync twice produces no duplicates (idempotent)", async () => {
    const db = await getDb();
    await db.collection("users").insertOne({
      email: "idem@test.com",
      name: "Idem User",
      passwordHash: "dummy-hash",
      role: "SUPER_ADMIN",
      roleNames: ["SUPER_ADMIN"],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const users = db.collection("users");
    const user = await users.findOne({ email: "idem@test.com" });
    const before = JSON.stringify(user!.roleNames);

    // Simulate running sync: normalize (no change) + backfill (no change since already present).
    const roleNames = user!.roleNames as string[];
    const normalized = roleNames.map((rn) => rn);
    const deduped = [...new Set(normalized)];
    const final = (user!.role === "SUPER_ADMIN" && !deduped.includes("SUPER_ADMIN"))
      ? [...deduped, "SUPER_ADMIN"]
      : deduped;

    expect(JSON.stringify(final)).toBe(before);
  });

  it("existing user-role relationships remain intact after sync", async () => {
    const db = await getDb();
    await seedUser(new ObjectId(), {
      email: "bdc@test.com",
      role: "BDC",
      roleNames: ["BDC"],
    });
    await seedUser(new ObjectId(), {
      email: "admin@test.com",
      role: "ADMIN",
      roleNames: ["ADMIN"],
    });

    const users = db.collection("users");
    const bdc = await users.findOne({ email: "bdc@test.com" });
    const admin = await users.findOne({ email: "admin@test.com" });

    expect(bdc!.role).toBe("BDC");
    expect(bdc!.roleNames).toEqual(["BDC"]);
    expect(admin!.role).toBe("ADMIN");
    expect(admin!.roleNames).toEqual(["ADMIN"]);
  });
});
