/**
 * PATCH /api/masters/[type]/[id] — update a master item
 * Mirrors Express `PATCH /agents/:id`, `/qualifications/:id`, `/rtos/:id`.
 * Supports qualifications, rtos, agents, supplier-routes.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import {
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
const VALID_ROUTE_STATUSES = new Set(["active", "expired"]);

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid master id." } },
    { status: 400 },
  );
}

export const PATCH = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ type?: string; id?: string }> | { type?: string; id?: string } | undefined },
  ) => {
    const resolvedParams = await (params ?? {});
    const { type, id } = resolvedParams;

    const perm = PERMISSION_MAP[String(type)];
    if (!perm) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown master type." } }, { status: 404 });
    }

    const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
    if (!auth?.roleNames?.includes("Super Admin") && !auth?.permissions?.includes(perm)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${perm}` } }, { status: 403 });
    }

    const masterId = safeObjectId(id);
    if (!masterId) return invalidId();

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const coll = await collection(String(type));
    const existing = await coll.findOne({ _id: masterId });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Master item not found." } }, { status: 404 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (type === "qualifications") {
      if (body.code !== undefined) {
        const code = normalizeCode(body.code);
        if (!(await isQualificationCodeUnique(code, String(existing._id)))) {
          return NextResponse.json(
            { error: { code: "CONFLICT", message: `Qualification code ${code} already exists.` } },
            { status: 409 },
          );
        }
        update.code = code;
      }
      if (body.title !== undefined) update.title = String(body.title).trim();
      if (body.trainingPackage !== undefined)
        update.trainingPackage = String(body.trainingPackage).trim();
      if (body.industry !== undefined) update.industry = String(body.industry).trim();
      if (body.status !== undefined) {
        if (!VALID_STATUSES.has(String(body.status))) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Invalid status." } },
            { status: 400 },
          );
        }
        update.status = String(body.status);
      }
      if (body.licensingRefs !== undefined) update.licensingRefs = body.licensingRefs;
    } else if (type === "rtos") {
      if (body.rtoCode !== undefined) {
        const rtoCode = normalizeCode(body.rtoCode);
        if (!(await isRtoCodeUnique(rtoCode, String(existing._id)))) {
          return NextResponse.json(
            { error: { code: "CONFLICT", message: `RTO code ${rtoCode} already exists.` } },
            { status: 409 },
          );
        }
        update.rtoCode = rtoCode;
      }
      if (body.legalName !== undefined) update.legalName = String(body.legalName).trim();
      if (body.tradingName !== undefined) update.tradingName = String(body.tradingName).trim();
      if (body.cricosCode !== undefined)
        update.cricosCode = body.cricosCode ? String(body.cricosCode).trim() : null;
      if (body.contacts !== undefined) update.contacts = body.contacts;
      if (body.status !== undefined) {
        if (!VALID_STATUSES.has(String(body.status))) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Invalid status." } },
            { status: 400 },
          );
        }
        update.status = String(body.status);
      }
      if (body.complianceNote !== undefined)
        update.complianceNote = String(body.complianceNote ?? "").trim() || null;
      if (body.website !== undefined)
        update.website = String(body.website ?? "").trim() || null;
    } else if (type === "agents") {
      const nextName = body.name !== undefined ? String(body.name).trim() : String(existing.name);
      const nextContact = body.contact !== undefined ? String(body.contact).trim() : String(existing.contact);
      if (body.name !== undefined) update.name = nextName;
      if (body.contact !== undefined) update.contact = nextContact;
      if ((body.name !== undefined || body.contact !== undefined) && !(await isAgentUnique(nextName, nextContact, String(existing._id)))) {
        return NextResponse.json(
          { error: { code: "CONFLICT", message: "An agent with this name and contact already exists." } },
          { status: 409 },
        );
      }
      if (body.type !== undefined) {
        if (!VALID_AGENT_TYPES.has(String(body.type))) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Invalid agent type." } },
            { status: 400 },
          );
        }
        update.type = String(body.type);
      }
      if (body.commissionRule !== undefined)
        update.commissionRule = String(body.commissionRule ?? "").trim() || null;
      if (body.active !== undefined) update.active = body.active === true;
    } else if (type === "supplier-routes") {
      const changes: Record<string, unknown> = {};
      if (body.qualificationId !== undefined) {
        const oid = safeObjectId(String(body.qualificationId));
        if (!oid) return invalidId();
        changes.qualificationId = oid;
      }
      if (body.sourceAgentId !== undefined) {
        const oid = safeObjectId(String(body.sourceAgentId));
        if (!oid) return invalidId();
        changes.sourceAgentId = oid;
      }
      if (body.rtoId !== undefined) {
        const oid = safeObjectId(String(body.rtoId));
        if (!oid) return invalidId();
        changes.rtoId = oid;
      }
      if (body.wholesaleCost !== undefined) {
        const cost = Number(body.wholesaleCost);
        if (!Number.isFinite(cost) || cost < 0) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Wholesale cost must be a non-negative number." } },
            { status: 400 },
          );
        }
        changes.wholesaleCost = cost;
      }
      if (body.effectiveFrom !== undefined) {
        if (!isValidDate(body.effectiveFrom)) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Effective from date is invalid." } },
            { status: 400 },
          );
        }
        changes.effectiveFrom = new Date(String(body.effectiveFrom)).toISOString();
      }
      if (body.effectiveTo !== undefined) {
        changes.effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)).toISOString() : null;
        if (changes.effectiveTo && Number.isNaN(new Date(changes.effectiveTo as string).getTime())) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Effective to date is invalid." } },
            { status: 400 },
          );
        }
      }
      if (body.status !== undefined) {
        if (!VALID_ROUTE_STATUSES.has(String(body.status))) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Invalid route status." } },
            { status: 400 },
          );
        }
        changes.status = String(body.status);
      }

      // Recompute effective dates for overlap check using proposed values.
      const qualificationId = changes.qualificationId ?? existing.qualificationId;
      const sourceAgentId = changes.sourceAgentId ?? existing.sourceAgentId;
      const rtoId = changes.rtoId ?? existing.rtoId;
      const effectiveFrom = changes.effectiveFrom
        ? new Date(changes.effectiveFrom as string)
        : new Date(existing.effectiveFrom);
      const effectiveTo = changes.effectiveTo !== undefined
        ? (changes.effectiveTo ? new Date(changes.effectiveTo as string) : null)
        : existing.effectiveTo
          ? new Date(existing.effectiveTo)
          : null;

      const candidates = await coll
        .find({
          qualificationId,
          sourceAgentId,
          rtoId,
          status: "active",
          _id: { $ne: masterId },
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

      Object.assign(update, changes);
    } else {
      // Fallback: copy allowed fields for any other type.
      for (const k of Object.keys(body)) {
        if (k !== "_id" && k !== "createdAt") update[k] = body[k];
      }
    }

    await coll.updateOne({ _id: masterId }, { $set: update });
    const updated = await coll.findOne({ _id: masterId });
    return NextResponse.json({ item: { id: String(updated?._id), ...updated } });
  },
);
