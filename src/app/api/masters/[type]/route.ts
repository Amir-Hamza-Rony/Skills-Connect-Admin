/**
 * GET /api/masters/[type] — list masters with optional search/filter/pagination
 * POST /api/masters/[type] — create master with validation and duplicate prevention
 *
 * Supported types: qualifications, rtos, agents, supplier-routes
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import {
  requireFields,
  normalizeCode,
  isQualificationCodeUnique,
  isRtoCodeUnique,
  isAgentUnique,
  isValidDate,
} from "@/lib/master-validation";

const PERMISSION_MAP: Record<string, string> = {
  qualifications: "qualifications.manage",
  rtos: "rto.manage",
  agents: "agents.manage",
  "supplier-routes": "pricing.manage",
};

const REQUIRED: Record<string, string[]> = {
  qualifications: ["code", "title", "trainingPackage", "industry", "status"],
  rtos: ["legalName", "tradingName", "rtoCode", "status"],
  agents: ["name", "type", "contact"],
  "supplier-routes": [
    "qualificationId",
    "sourceAgentId",
    "rtoId",
    "wholesaleCost",
    "effectiveFrom",
  ],
};

const VALID_STATUSES = new Set([
  "current",
  "superseded",
  "active",
  "at-risk",
  "suspended",
  "inactive",
]);
const VALID_AGENT_TYPES = new Set([
  "sales_closing",
  "certificate_source",
  "rto_contact",
]);

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

export const GET = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ type?: string }> | { type?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { type } = resolvedParams;
    const perm = PERMISSION_MAP[String(type)];
    if (!perm) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown master type." } }, { status: 404 });
    }
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
    if (!auth?.roleNames?.includes("Super Admin") && !auth?.permissions?.includes(perm)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${perm}` } }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);
    const search = (searchParams.get("search") ?? "").trim();
    const status = (searchParams.get("status") ?? "").trim();

    const coll = await collection(String(type));
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (search) {
      const regex = new RegExp(String(search), "i");
      if (type === "qualifications") {
        filter.$or = [{ code: regex }, { title: regex }];
      } else if (type === "rtos") {
        filter.$or = [{ legalName: regex }, { tradingName: regex }, { rtoCode: regex }];
      } else if (type === "agents") {
        filter.$or = [{ name: regex }, { contact: regex }];
      } else if (type === "supplier-routes") {
        filter.$or = [
          { qualificationId: { $regex: regex, $options: "i" } },
          { sourceAgentId: { $regex: regex, $options: "i" } },
          { rtoId: { $regex: regex, $options: "i" } },
        ];
      }
    }

    const [docs, total] = await Promise.all([
      coll
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      coll.countDocuments(filter),
    ]);

    return NextResponse.json({
      items: docs.map((d: any) => ({ id: String(d._id), ...d })),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);

export const POST = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ type?: string }> | { type?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { type } = resolvedParams;
    const perm = PERMISSION_MAP[String(type)];
    if (!perm) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown master type." } }, { status: 404 });
    }
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
    if (!auth?.roleNames?.includes("Super Admin") && !auth?.permissions?.includes(perm)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${perm}` } }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const required = REQUIRED[String(type)];
    if (!required) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown master type." } }, { status: 404 });
    }
    const missing = requireFields(body, required);
    if (missing) {
      return NextResponse.json({ error: { code: missing.code, message: missing.message } }, { status: 400 });
    }

    const coll = await collection(String(type));
    const now = new Date();

    if (type === "qualifications") {
      const code = normalizeCode(body.code);
      if (!(await isQualificationCodeUnique(code))) {
        return NextResponse.json(
          { error: { code: "CONFLICT", message: `Qualification code ${code} already exists.` } },
          { status: 409 },
        );
      }
      if (!VALID_STATUSES.has(String(body.status))) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid status." } },
          { status: 400 },
        );
      }
      const result = await coll.insertOne({
        code,
        title: String(body.title).trim(),
        trainingPackage: String(body.trainingPackage).trim(),
        industry: String(body.industry).trim(),
        status: String(body.status),
        licensingRefs: body.licensingRefs ?? [],
        createdAt: now,
        updatedAt: now,
      } as any);
      return NextResponse.json(
        { id: String(result.insertedId), ...body, code },
        { status: 201 },
      );
    }

    if (type === "rtos") {
      const rtoCode = normalizeCode(body.rtoCode);
      if (!(await isRtoCodeUnique(rtoCode))) {
        return NextResponse.json(
          { error: { code: "CONFLICT", message: `RTO code ${rtoCode} already exists.` } },
          { status: 409 },
        );
      }
      if (!VALID_STATUSES.has(String(body.status))) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid status." } },
          { status: 400 },
        );
      }
      const result = await coll.insertOne({
        legalName: String(body.legalName).trim(),
        tradingName: String(body.tradingName).trim(),
        rtoCode,
        cricosCode: body.cricosCode ?? null,
        contacts: body.contacts ?? [],
        status: String(body.status),
        complianceNote: String(body.complianceNote ?? "").trim() || null,
        website: String(body.website ?? "").trim() || null,
        createdAt: now,
        updatedAt: now,
      } as any);
      return NextResponse.json(
        { id: String(result.insertedId), ...body, rtoCode },
        { status: 201 },
      );
    }

    if (type === "agents") {
      const name = String(body.name).trim();
      const contact = String(body.contact).trim();
      const agentType = String(body.type);
      if (!VALID_AGENT_TYPES.has(agentType)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid agent type." } },
          { status: 400 },
        );
      }
      if (!(await isAgentUnique(name, contact))) {
        return NextResponse.json(
          { error: { code: "CONFLICT", message: "An agent with this name and contact already exists." } },
          { status: 409 },
        );
      }
      const result = await coll.insertOne({
        name,
        type: agentType,
        contact,
        commissionRule: String(body.commissionRule ?? "").trim() || null,
        active: body.active !== false,
        createdAt: now,
        updatedAt: now,
      } as any);
      return NextResponse.json(
        { id: String(result.insertedId), name, type: agentType, contact },
        { status: 201 },
      );
    }

    if (type === "supplier-routes") {
      const qualificationId = safeObjectId(String(body.qualificationId));
      const sourceAgentId = safeObjectId(String(body.sourceAgentId));
      const rtoId = safeObjectId(String(body.rtoId));
      if (!qualificationId || !sourceAgentId || !rtoId) return invalidId();

      // Validate referenced records exist.
      const qColl = await collection("qualifications");
      const aColl = await collection("agents");
      const rColl = await collection("rtos");
      const [qual, agent, rto] = await Promise.all([
        qColl.findOne({ _id: qualificationId }),
        aColl.findOne({ _id: sourceAgentId }),
        rColl.findOne({ _id: rtoId }),
      ]);
      if (!qual) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Qualification not found." } },
          { status: 404 },
        );
      }
      if (!agent) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Source agent not found." } },
          { status: 404 },
        );
      }
      if (!rto) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "RTO not found." } },
          { status: 404 },
        );
      }

      const wholesaleCost = Number(body.wholesaleCost);
      if (!Number.isFinite(wholesaleCost) || wholesaleCost < 0) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Wholesale cost must be a non-negative number." } },
          { status: 400 },
        );
      }
      if (!isValidDate(body.effectiveFrom)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Effective from date is required." } },
          { status: 400 },
        );
      }

      const effectiveFrom = new Date(String(body.effectiveFrom));
      const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;
      if (effectiveTo && Number.isNaN(effectiveTo.getTime())) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Effective to date is invalid." } },
          { status: 400 },
        );
      }
      if (effectiveTo && effectiveTo < effectiveFrom) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Effective to must be after effective from." } },
          { status: 400 },
        );
      }

      // Prevent duplicate active routes with overlapping effective windows.
      const candidates = await coll
        .find({
          qualificationId,
          sourceAgentId,
          rtoId,
          status: "active",
        } as any)
        .toArray();
      const newEnd = effectiveTo ?? new Date("9999-12-31");
      const overlapping = candidates.some((c: any) => {
        const cStart = c.effectiveFrom ? new Date(c.effectiveFrom) : new Date(0);
        const cEnd = c.effectiveTo ? new Date(c.effectiveTo) : new Date("9999-12-31");
        return cStart <= newEnd && cEnd >= effectiveFrom;
      });
      if (overlapping) {
        return NextResponse.json(
          {
            error: {
              code: "CONFLICT",
              message: "An active supplier route already exists for this qualification, source agent and RTO with an overlapping effective period.",
            },
          },
          { status: 409 },
        );
      }

      const result = await coll.insertOne({
        qualificationId,
        sourceAgentId,
        rtoId,
        wholesaleCost,
        currency: "AUD",
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveTo: effectiveTo ? effectiveTo.toISOString() : null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      } as any);
      return NextResponse.json(
        { id: String(result.insertedId), wholesaleCost, status: "active" },
        { status: 201 },
      );
    }

    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown master type." } }, { status: 404 });
  },
);
