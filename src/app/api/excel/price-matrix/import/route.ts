/**
 * POST /api/excel/price-matrix/import — Import verified Price Matrix rows as
 * supplier routes. Each row must have a valid qualificationId, rtoId and
 * sourceAgentId. Unresolved rows (missing agent or unresolved references)
 * are reported as pending and are NOT imported.
 *
 * Preserves historical supplier-route records: expiring an old route and
 * creating a new one is the supported pattern for cost changes.
 */
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "pricing.manage";

async function requireAuth(req: AuthedRequest) {
  const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
  if (
    !auth?.roleNames?.includes("SUPER_ADMIN") &&
    !auth?.permissions?.includes(PERMISSION)
  ) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } },
      { status: 403 },
    );
  }
  return null;
}

interface ImportRow {
  qualificationId: string;
  rtoId: string;
  sourceAgentId: string;
  wholesaleCost: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const actor = (req as AuthedRequest).auth!;
    let body: { rows: ImportRow[] };
    try {
      body = (await req.json()) as { rows: ImportRow[] };
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "rows must be a non-empty array." } },
        { status: 400 },
      );
    }

    const now = new Date();

    const imported: Array<{ rowIndex: number; id: string; qualificationId: string; rtoId: string; sourceAgentId: string; wholesaleCost: number }> = [];
    const pending: Array<{ rowIndex: number; reason: string; row: ImportRow }> = [];
    const errors: Array<{ rowIndex: number; code: string; message: string }> = [];

    const routeColl = await collection("supplier-routes");
    const qualColl = await collection("qualifications");
    const agentColl = await collection("agents");
    const rtoColl = await collection("rtos");

    // Pre-load all referenced records for efficient validation.
    const qualIds = new Set<string>();
    const agentIds = new Set<string>();
    const rtoIds = new Set<string>();
    for (const row of body.rows) {
      if (row.qualificationId) qualIds.add(row.qualificationId);
      if (row.sourceAgentId) agentIds.add(row.sourceAgentId);
      if (row.rtoId) rtoIds.add(row.rtoId);
    }

    const qualMap = new Map<string, any>();
    const agentMap = new Map<string, any>();
    const rtoMap = new Map<string, any>();

    for (const id of qualIds) {
      const oid = safeObjectId(id);
      if (oid) {
        const doc = await qualColl.findOne({ _id: oid });
        if (doc) qualMap.set(id, doc);
      }
    }
    for (const id of agentIds) {
      const oid = safeObjectId(id);
      if (oid) {
        const doc = await agentColl.findOne({ _id: oid });
        if (doc) agentMap.set(id, doc);
      }
    }
    for (const id of rtoIds) {
      const oid = safeObjectId(id);
      if (oid) {
        const doc = await rtoColl.findOne({ _id: oid });
        if (doc) rtoMap.set(id, doc);
      }
    }

    // Detect conflicts: multiple rows for the same qualification+rto combination
    // with different agents.
    const combinationAgentMap = new Map<string, Set<string>>();
    // Track combination date ranges within the batch for conflict detection.
    const batchCombinationRanges = new Map<string, Array<{ effectiveFrom: Date; effectiveTo: Date | null; rowIndex: number }>>();
    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      const key = `${row.qualificationId}|${row.rtoId}`;
      if (!combinationAgentMap.has(key)) combinationAgentMap.set(key, new Set());
      if (row.sourceAgentId) combinationAgentMap.get(key)!.add(row.sourceAgentId);
    }

    // Import each row.
    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];

      // Validate IDs.
      const qualOid = safeObjectId(row.qualificationId);
      const agentOid = safeObjectId(row.sourceAgentId);
      const rtoOid = safeObjectId(row.rtoId);
      if (!qualOid || !agentOid || !rtoOid) {
        pending.push({
          rowIndex: i,
          reason: "Invalid qualification, agent, or RTO ID format.",
          row,
        });
        continue;
      }

      // Validate referenced records exist.
      const qual = qualMap.get(row.qualificationId);
      const agent = agentMap.get(row.sourceAgentId);
      const rto = rtoMap.get(row.rtoId);
      if (!qual) {
        pending.push({ rowIndex: i, reason: `Qualification not found: ${row.qualificationId}`, row });
        continue;
      }
      if (!agent) {
        pending.push({ rowIndex: i, reason: `Source agent not found: ${row.sourceAgentId}`, row });
        continue;
      }
      if (!rto) {
        pending.push({ rowIndex: i, reason: `RTO not found: ${row.rtoId}`, row });
        continue;
      }

      // Validate agent is a certificate_source and active.
      if (agent.type !== "certificate_source") {
        pending.push({ rowIndex: i, reason: `Agent "${agent.name}" is not a certificate source agent.`, row });
        continue;
      }
      if (agent.active === false) {
        pending.push({ rowIndex: i, reason: `Agent "${agent.name}" is not active.`, row });
        continue;
      }

      // Validate wholesale cost.
      const wholesaleCost = Number(row.wholesaleCost);
      if (!Number.isFinite(wholesaleCost) || wholesaleCost < 0) {
        pending.push({ rowIndex: i, reason: "Wholesale cost must be a non-negative number.", row });
        continue;
      }

      // Validate currency.
      const validCurrencies = new Set(["AUD", "BDT", "USD", "GBP", "EUR", "INR"]);
      if (!row.currency || !validCurrencies.has(row.currency)) {
        pending.push({ rowIndex: i, reason: `Currency must be one of: ${Array.from(validCurrencies).join(", ")}.`, row });
        continue;
      }
      const currency = row.currency;

      // Validate effective dates.
      if (!row.effectiveFrom) {
        pending.push({ rowIndex: i, reason: "Effective from date is required.", row });
        continue;
      }
      const effectiveFrom = new Date(row.effectiveFrom);
      if (Number.isNaN(effectiveFrom.getTime())) {
        pending.push({ rowIndex: i, reason: "Effective from date is invalid.", row });
        continue;
      }
      const effectiveTo = row.effectiveTo ? new Date(row.effectiveTo) : null;
      if (effectiveTo && Number.isNaN(effectiveTo.getTime())) {
        pending.push({ rowIndex: i, reason: "Effective to date is invalid.", row });
        continue;
      }
      if (effectiveTo && effectiveTo < effectiveFrom) {
        pending.push({ rowIndex: i, reason: "Effective to must be after effective from.", row });
        continue;
      }

      // Conflict: multiple agents proposed for same qualification+rto.
      const key = `${row.qualificationId}|${row.rtoId}`;
      const agentsForCombo = combinationAgentMap.get(key);
      if (agentsForCombo && agentsForCombo.size > 1 && agentsForCombo.has(row.sourceAgentId)) {
        pending.push({
          rowIndex: i,
          reason: `Multiple sourcing agents proposed for qualification ${qual.code} + RTO ${rto.rtoCode}. Manual confirmation required.`,
          row,
        });
        continue;
      }

      // Batch-level conflict: same qualification + RTO combination with overlapping dates
      // already proposed earlier in this import batch.
      const newEnd = effectiveTo ? new Date(effectiveTo) : new Date("9999-12-31");
      const existingBatchRanges = batchCombinationRanges.get(key) ?? [];
      const batchOverlap = existingBatchRanges.some((b) => {
        const bStart = b.effectiveFrom;
        const bEnd = b.effectiveTo ?? new Date("9999-12-31");
        return bStart <= newEnd && bEnd >= effectiveFrom;
      });
      if (batchOverlap) {
        pending.push({
          rowIndex: i,
          reason: "Multiple sourcing agents proposed for the same qualification + RTO combination with overlapping dates in this import. Manual confirmation required.",
          row,
        });
        continue;
      }

      // Prevent duplicate active routes with overlapping effective windows
      // for the same qualification + RTO combination, regardless of agent.
      const candidates = await routeColl
        .find({
          qualificationId: qualOid,
          rtoId: rtoOid,
          status: "active",
        } as any)
        .toArray();
      const overlapping = candidates.some((c: any) => {
        const cStart = c.effectiveFrom ? new Date(c.effectiveFrom) : new Date(0);
        const cEnd = c.effectiveTo ? new Date(c.effectiveTo) : new Date("9999-12-31");
        return cStart <= newEnd && cEnd >= effectiveFrom;
      });
      if (overlapping) {
        pending.push({
          rowIndex: i,
          reason: "An active supplier route already exists for this qualification + RTO combination with an overlapping effective period. Manual confirmation required.",
          row,
        });
        continue;
      }

      // Temporary guard document for mutual exclusion on this qualification +
      // RTO combination. MongoDB's _id unique index makes the guard insert
      // atomic: if another import already holds the guard, this insert fails
      // with code 11000 and the row is pended. The guard is deleted after the
      // route insert (success or failure), so it never persists.
      const guardColl = await collection("excel_imports");
      const guardId = `price_matrix_lock:${qualOid}:${rtoOid}`;
      const ownerToken = randomUUID();
      let guardInserted = false;
      try {
        await guardColl.insertOne(
          {
            _id: guardId,
            type: "price_matrix_lock",
            qualificationId: String(qualOid),
            rtoId: String(rtoOid),
            ownerToken,
            createdAt: now,
          } as any,
        );
        guardInserted = true;
      } catch (guardErr: any) {
        if (guardErr?.code === 11000) {
          pending.push({
            rowIndex: i,
            reason: "Another import is processing this qualification + RTO combination. Please try again shortly.",
            row,
          });
          continue;
        }
        // Non-11000 error on guard insert: treat as server error, no guard was created.
        errors.push({
          rowIndex: i,
          code: "SERVER_ERROR",
          message: guardErr?.message ?? "Failed to acquire import guard.",
        });
        continue;
      }

      try {
        // Re-check for overlapping active routes (guard prevents concurrent
        // requests, but we still validate within this request).
        const candidates = await routeColl
          .find({
            qualificationId: qualOid,
            rtoId: rtoOid,
            status: "active",
          } as any)
          .toArray();
        const newEnd = effectiveTo ? new Date(effectiveTo) : new Date("9999-12-31");
        const overlapping = candidates.some((c: any) => {
          const cStart = c.effectiveFrom ? new Date(c.effectiveFrom) : new Date(0);
          const cEnd = c.effectiveTo ? new Date(c.effectiveTo) : new Date("9999-12-31");
          return cStart <= newEnd && cEnd >= effectiveFrom;
        });
        if (overlapping) {
          pending.push({
            rowIndex: i,
            reason: "An active supplier route already exists for this qualification + RTO combination with an overlapping effective period. Manual confirmation required.",
            row,
          });
          continue;
        }

        // Insert the supplier route.
        const result = await routeColl.insertOne({
          qualificationId: qualOid,
          sourceAgentId: agentOid,
          rtoId: rtoOid,
          wholesaleCost,
          currency,
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveTo: effectiveTo ? effectiveTo.toISOString() : null,
          status: "active",
          createdAt: now,
          updatedAt: now,
        } as any);

        // Record batch date range only after successful insert.
        if (!batchCombinationRanges.has(key)) batchCombinationRanges.set(key, []);
        batchCombinationRanges.get(key)!.push({
          effectiveFrom,
          effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
          rowIndex: i,
        });

        imported.push({
          rowIndex: i,
          id: String(result.insertedId),
          qualificationId: row.qualificationId,
          rtoId: row.rtoId,
          sourceAgentId: row.sourceAgentId,
          wholesaleCost,
        });
      } catch (err: any) {
        if (err?.code === 11000) {
          pending.push({
            rowIndex: i,
            reason: "Duplicate supplier route (unique constraint violation).",
            row,
          });
        } else {
          errors.push({
            rowIndex: i,
            code: "SERVER_ERROR",
            message: err?.message ?? "Failed to create supplier route.",
          });
        }
      } finally {
        // Always delete the temporary guard document, whether the insert
        // succeeded or failed, so it never persists.
        if (guardInserted) {
          try {
            const cleanupResult = await guardColl.deleteOne({
              _id: guardId,
              ownerToken,
            });
            if (cleanupResult.deletedCount === 0) {
              // Another request already removed this guard (ownership lost).
              // Do not treat as fatal — log for observability only.
              console.error(
                "[price_matrix_lock] guard cleanup deletedCount=0 — ownership mismatch or already removed:",
                { guardId, qualificationId: String(qualOid), rtoId: String(rtoOid) },
              );
              await writeAudit({
                actorId: actor.userId,
                actorEmail: actor.email,
                entityType: "excel_price_matrix",
                entityId: null,
                action: "guard_cleanup_ownership_mismatch",
                before: null,
                after: { guardId, qualificationId: String(qualOid), rtoId: String(rtoOid) },
              }).catch(() => {});
            }
          } catch (cleanupErr: any) {
            // Cleanup failure must not override the original import result.
            console.error(
              "[price_matrix_lock] guard cleanup failed:",
              { guardId, qualificationId: String(qualOid), rtoId: String(rtoOid), error: cleanupErr?.message },
            );
            await writeAudit({
              actorId: actor.userId,
              actorEmail: actor.email,
              entityType: "excel_price_matrix",
              entityId: null,
              action: "guard_cleanup_failed",
              before: null,
              after: { guardId, qualificationId: String(qualOid), rtoId: String(rtoOid), error: cleanupErr?.message },
            }).catch(() => {});
          }
        }
      }
    }

    // Write audit record.
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_price_matrix",
      entityId: null,
      action: "import",
      before: null,
      after: {
        totalRows: body.rows.length,
        imported: imported.length,
        pending: pending.length,
        errors: errors.length,
      },
    });

    return NextResponse.json({
      result: {
        totalRows: body.rows.length,
        importedCount: imported.length,
        pendingCount: pending.length,
        errorCount: errors.length,
        imported,
        pending,
        errors,
      },
    }, { status: 201 });
  },
);
