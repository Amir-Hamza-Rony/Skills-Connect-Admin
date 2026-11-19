/**
 * Regression coverage for the stale scalar `role` vs authoritative
 * `roleNames` mismatch found during Phase 4 visual QA.
 *
 * All data is seeded into the in-memory test database (tests/setup.ts).
 * No production records are read or modified.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { GET as dashboard } from "@/app/api/reports/dashboard/route";
import { GET as me } from "@/app/api/auth/me/route";
import { signAccessToken } from "@/lib/api-auth";
import { resolvePrimaryRole } from "@/lib/permissions";
import {
  clearDb,
  seedClient,
  seedOrder,
  seedQualification,
  seedRto,
} from "./helpers";

const AGENT_PERMISSIONS = [
  "clients.view",
  "clients.manage",
  "orders.view",
  "orders.manage",
  "documents.view",
  "reports.view",
];

const ADMIN_PERMISSIONS = [
  "clients.view",
  "clients.manage",
  "orders.view",
  "orders.manage",
  "finance.view",
  "finance.manage",
  "reports.view",
];

/** Signed token reproducing the real accounts: scalar role stuck on BDC. */
function staleRoleToken(userId: string, roleNames: string[], permissions: string[]) {
  return signAccessToken({
    userId,
    name: "QA User",
    email: "qa-role@test.com",
    full_name: "QA User",
    role: "BDC",
    roleNames,
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
    permissions,
  });
}

function request(url: string, token: string) {
  return new NextRequest(`http://localhost${url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function seedScopedOrders() {
  const qualificationId = await seedQualification();
  const rtoId = await seedRto();

  const bdcClient = await seedClient(new ObjectId(), "BDC QA Client", "bdc-qa@test.com");
  const b2bClient = await seedClient(new ObjectId(), "B2B QA Client", "b2b-qa@test.com");
  const adminClient = await seedClient(new ObjectId(), "Admin QA Client", "admin-qa@test.com");

  const bdcOrder = await seedOrder(new ObjectId(), bdcClient, qualificationId, new ObjectId(), new ObjectId(), rtoId, {
    status: "Completed",
    bdc_id: "qa-bdc-user",
    sellingPrice: 5000,
    currency: "AUD",
  });
  const b2bOrder = await seedOrder(new ObjectId(), b2bClient, qualificationId, new ObjectId(), new ObjectId(), rtoId, {
    status: "New",
    b2b_agent_id: "qa-b2b-user",
    sellingPrice: 7000,
    currency: "AUD",
  });
  const adminOrder = await seedOrder(new ObjectId(), adminClient, qualificationId, new ObjectId(), new ObjectId(), rtoId, {
    status: "Awaiting Payment",
    sellingPrice: 9000,
    currency: "AUD",
  });

  return { bdcClient, b2bClient, adminClient, bdcOrder, b2bOrder, adminOrder };
}

describe("Role normalization — authoritative roleNames", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("prefers canonical roleNames in priority order and only falls back to a legacy role", () => {
    expect(resolvePrimaryRole({ role: "BDC", roleNames: ["ADMIN"] })).toBe("ADMIN");
    expect(resolvePrimaryRole({ role: "BDC", roleNames: ["B2B_AGENT"] })).toBe("B2B_AGENT");
    expect(resolvePrimaryRole({ role: "BDC", roleNames: ["BDC", "ADMIN"] })).toBe("ADMIN");
    expect(resolvePrimaryRole({ role: "BDC", roleNames: [] })).toBe("BDC");
    expect(resolvePrimaryRole({ role: "BDC", roleNames: ["Super Admin"] })).toBe("BDC");
    expect(resolvePrimaryRole({ role: null, roleNames: ["UNKNOWN"] })).toBeNull();
  });

  it("reports ADMIN consistently in /auth/me and the dashboard for a stale BDC scalar", async () => {
    const token = staleRoleToken("qa-admin-user", ["ADMIN"], ADMIN_PERMISSIONS);

    const meRes = await me(request("/api/auth/me", token));
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).user.role).toBe("ADMIN");

    const dashRes = await dashboard(request("/api/reports/dashboard", token));
    expect(dashRes.status).toBe(200);
    const body = await dashRes.json();
    expect(body.role).toBe("ADMIN");
    expect(body.scope.scoped).toBe(false);
    expect(body.availability.finance.available).toBe(true);
  });

  it("scopes a stale BDC/B2B_AGENT scalar to b2b_agent_id orders and masks price", async () => {
    const f = await seedScopedOrders();
    const token = staleRoleToken("qa-b2b-user", ["B2B_AGENT"], AGENT_PERMISSIONS);

    const res = await dashboard(request("/api/reports/dashboard", token));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.role).toBe("B2B_AGENT");
    expect(body.scope).toMatchObject({ scoped: true, orders: 1, clients: 1 });
    expect(body.tables.orders.map((o: any) => o.id)).toEqual([String(f.b2bOrder)]);
    expect(body.tables.clients.map((c: any) => c.id)).toEqual([String(f.b2bClient)]);
    expect(body.tables.orders[0].amount).toBeUndefined();
    expect(body.availability.finance.available).toBe(false);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(String(f.bdcOrder));
    expect(serialized).not.toContain(String(f.adminOrder));
  });

  it("keeps a stale BDC/BDC scalar scoped to bdc_id orders with price visible", async () => {
    const f = await seedScopedOrders();
    const token = staleRoleToken("qa-bdc-user", ["BDC"], AGENT_PERMISSIONS);

    const res = await dashboard(request("/api/reports/dashboard", token));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.role).toBe("BDC");
    expect(body.scope).toMatchObject({ scoped: true, orders: 1, clients: 1 });
    expect(body.tables.orders.map((o: any) => o.id)).toEqual([String(f.bdcOrder)]);
    expect(body.tables.orders[0].amount).toBe(5000);
  });

  it("keeps price masked for a dual BDC + B2B_AGENT account", async () => {
    await seedScopedOrders();
    const token = staleRoleToken(
      "qa-bdc-user",
      ["BDC", "B2B_AGENT"],
      AGENT_PERMISSIONS,
    );

    const res = await dashboard(request("/api/reports/dashboard", token));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Primary role stays deterministic for labels/scoping, but the B2B_AGENT
    // claim still forces fail-closed financial masking.
    expect(body.role).toBe("BDC");
    expect(body.tables.orders).toHaveLength(1);
    expect(body.tables.orders[0].amount).toBeUndefined();
    expect(body.availability.finance.available).toBe(false);
  });
});
