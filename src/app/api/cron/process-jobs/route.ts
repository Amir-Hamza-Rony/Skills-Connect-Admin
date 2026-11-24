/**
 * POST /api/cron/process-jobs — process due background jobs.
 *
 * Vercel-compatible: no persistent worker. This endpoint is invoked by
 * Vercel Cron (see vercel.json) or manually. It claims a bounded batch of
 * due jobs, processes each one, and returns a summary.
 *
 * Authorization: requires `settings.manage` (super-admin / admin only).
 *
 * Idempotency & safety:
 *  - Atomic claim via findOneAndUpdate (locked status + lockedBy + lockedAt).
 *  - Stale locks (>10 min) are re-claimable.
 *  - Bounded batch (default 25) to avoid serverless timeouts.
 *  - Each job processed with its own error handling; one failure does not
 *    abort the batch.
 *  - Failed jobs retried with exponential backoff; dead-lettered after
 *    maxAttempts.
 *  - Duplicate execution impossible for the same job id within a lock TTL.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import {
  claimJobs,
  completeJob,
  failJob,
  retryJob,
  INSTANCE_ID,
} from "@/lib/jobs";

/** Job handlers. Each returns void on success or throws on failure. */
async function handleJob(job: {
  type: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  switch (job.type) {
    case "qb_sync":
      await handleQbSync(job.payload);
      break;
    case "qb_retry":
      await handleQbRetry(job.payload);
      break;
    case "invoice_sync":
      await handleInvoiceSync(job.payload);
      break;
    case "overdue_check":
      await handleOverdueCheck(job.payload);
      break;
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function handleQbSync(_payload: Record<string, unknown>): Promise<void> {
  const mod = await import("@/lib/quickbooks");
  // Enumerate pending QB sync records and mark them for retry.
  const records = await mod.listSyncRecords?.();
  if (!records) return;
  for (const record of records) {
    if (record.status === "Pending" || record.status === "Failed") {
      // The actual transport is a stub (see PHASE-8C-3). We record the
      // retry attempt but do not make live Intuit calls here.
      await mod.retrySync?.(
        record.entityType as "invoice" | "payment",
        record.entityId,
        { id: "cron", email: "cron@system" },
      );
    }
  }
}

async function handleQbRetry(_payload: Record<string, unknown>): Promise<void> {
  // No-op at this layer: individual QB retries are triggered by
  // POST /api/integrations/quickbooks/sync/[type]/[id].
}

async function handleInvoiceSync(_payload: Record<string, unknown>): Promise<void> {
  // No-op at this layer: invoice sync is triggered by
  // POST /api/invoices/[id]/sync. This job type is reserved for future
  // batch invoice sync.
}

async function handleOverdueCheck(_payload: Record<string, unknown>): Promise<void> {
  // No-op at this layer: overdue status is computed on read
  // (see GET /api/workflow/tasks). This job type is reserved for future
  // proactive overdue notifications.
}

export const POST = withAuth("settings.manage",
  async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const batchSizeParam = searchParams.get("batchSize");
    const batchSize = batchSizeParam ? Number(batchSizeParam) : 25;
    const now = new Date();

    const claimed = await claimJobs({
      batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 25,
      now,
      instanceId: INSTANCE_ID,
    });

    const processed: Array<{ id: string; type: string; status: string }> = [];
    const errors: Array<{ id: string; type: string; error: string }> = [];

    for (const job of claimed) {
      try {
        await handleJob(job);
        await completeJob(job._id);
        processed.push({
          id: String(job._id),
          type: job.type,
          status: "completed",
        });
      } catch (err: any) {
        await retryJob(job._id, err?.message ?? "Job failed");
        errors.push({
          id: String(job._id),
          type: job.type,
          error: err?.message ?? "Job failed",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      instanceId: INSTANCE_ID,
      processedAt: now.toISOString(),
      claimed: claimed.length,
      completed: processed.length,
      failed: errors.length,
      processed,
      errors,
    });
  },
);
