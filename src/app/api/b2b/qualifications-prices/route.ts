/**
 * GET /api/b2b/qualifications-prices
 *
 * Returns all qualifications joined with every supplier route wholesale
 * cost available for them. Accessible to SUPER_ADMIN, ADMIN, and B2B_AGENT
 * roles — B2B agents use this to view all qualifications under them along
 * with their corresponding wholesale prices.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { resolvePrimaryRole } from "@/lib/permissions";
import type { RoleName } from "@/lib/types";

const ALLOWED_ROLES: RoleName[] = ["SUPER_ADMIN", "ADMIN", "B2B_AGENT"];

export const GET = withAuth(
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    const role = resolvePrimaryRole(auth);

    if (!role || !ALLOWED_ROLES.includes(role)) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "B2B Agent, Admin, or Super Admin access required.",
          },
        },
        { status: 403 },
      );
    }

    const [qualsColl, routesColl, rtosColl] = await Promise.all([
      collection("qualifications"),
      collection("supplier-routes"),
      collection("rtos"),
    ]);

    const [qualsResult, routesResult, rtosResult] = await Promise.all([
      qualsColl.find({}).toArray(),
      routesColl.find({}).toArray(),
      rtosColl.find({}).toArray(),
    ]);

    const quals = qualsResult;
    const routes = routesResult;
    const rtos = rtosResult;

    const rtoMap = new Map<string, any>();
    for (const r of rtos) {
      rtoMap.set(String(r._id), r);
    }

    // Build an index of routes by qualificationId, each with wholesale cost + RTO info.
    const routesByQual = new Map<string, Array<{
      rtoName: string;
      rtoCode: string | null;
      wholesaleCost: number;
      sourceAgentId: string;
      currency: string;
      effectiveFrom: string | null;
    }>>();
    for (const route of routes) {
      const qId = String(route.qualificationId);
      const rto = rtoMap.get(String(route.rtoId));
      let entry = routesByQual.get(qId);
      if (!entry) {
        entry = [];
        routesByQual.set(qId, entry);
      }
      entry.push({
        rtoName: rto?.tradingName ?? rto?.legalName ?? "Unknown RTO",
        rtoCode: rto?.rtoCode ?? null,
        wholesaleCost: route.wholesaleCost ?? 0,
        sourceAgentId: String(route.sourceAgentId ?? ""),
        currency: route.currency ?? "AUD",
        effectiveFrom: route.effectiveFrom
          ? new Date(route.effectiveFrom).toISOString()
          : null,
      });
    }

    const items = quals.map((q: any) => ({
      id: String(q._id),
      code: q.code,
      title: q.title,
      trainingPackage: q.trainingPackage,
      industry: q.industry,
      status: q.status,
      supplierRoutes: routesByQual.get(String(q._id)) ?? [],
    }));

    return NextResponse.json({ items, total: items.length });
  },
);
