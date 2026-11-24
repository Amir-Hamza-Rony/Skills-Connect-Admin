/**
 * Vercel-compatible background job system backed by MongoDB.
 *
 * Design constraints (Vercel serverless):
 *  - No persistent worker process. Jobs are processed on demand by hitting
 *    the `/api/cron/process-jobs` endpoint (Vercel Cron or manual trigger).
 *  - No in-memory durable queue. All state lives in MongoDB so any instance
 *    can claim and process jobs.
 *  - Bounded batch processing per invocation to avoid serverless timeouts.
 *  - Atomic claim via findOneAndUpdate so concurrent invocations cannot
 *    double-process the same job.
 *  - Exponential backoff retry with max attempts and dead-letter failed
 *    status.
 *  - Idempotency keys prevent duplicate job creation.
 *
 * Job lifecycle:
 *   pending -> locked (claimed) -> completed
 *   pending -> locked -> failed (after maxAttempts)
 *   pending -> locked -> pending (retry with backoff, attempts < maxAttempts)
 */

import { collection, toObjectId } from "@/lib/db";

export type JobType =
  | "qb_sync"
  | "qb_retry"
  | "invoice_sync"
  | "overdue_check";

export type JobStatus = "pending" | "locked" | "completed" | "failed";

export interface Job {
  _id?: unknown;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 25;
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Instance id for this process - used for lock ownership tracking. */
export const INSTANCE_ID = `vercel-${process.env.VERCEL_REGION ?? "local"}-${process.pid}`;

/** Backoff delay in ms for a given attempt number (exponential). */
function backoffMs(attempt: number): number {
  // 2s, 8s, 32s, 128s, 512s ...
  return Math.min(2 ** (attempt + 1) * 1000, 10 * 60 * 1000);
}

/** Enqueue a job. Returns null if an identical idempotency job already exists. */
export async function enqueueJob(args: {
  type: JobType;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  nextRunAt?: Date;
  idempotencyKey?: string;
}): Promise<{ id: string } | null> {
  const db = await collection("jobs");
  const {
    type,
    payload,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    nextRunAt = new Date(),
    idempotencyKey = null,
  } = args;

  // Idempotency: skip if an identical pending/locked job already exists.
  if (idempotencyKey) {
    const existing = await db.findOne({
      type,
      idempotencyKey,
      status: { $in: ["pending", "locked"] },
    });
    if (existing) return null;
  }

  const now = new Date();
  const result = await db.insertOne({
    type,
    status: "pending",
    payload,
    attempts: 0,
    maxAttempts,
    nextRunAt,
    lastError: null,
    lockedAt: null,
    lockedBy: null,
    idempotencyKey,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });

  return { id: String(result.insertedId) };
}

/** Claim a bounded batch of due pending jobs. Returns claimed jobs. */
export async function claimJobs(args: {
  batchSize?: number;
  now?: Date;
  instanceId?: string;
}): Promise<Job[]> {
  const db = await collection("jobs");
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    now = new Date(),
    instanceId = INSTANCE_ID,
  } = args;

  const claimed: Job[] = [];
  let remaining = batchSize;

  while (remaining > 0) {
    const job = await db.findOneAndUpdate(
      {
        status: "pending",
        nextRunAt: { $lte: now },
        $or: [
          { lockedAt: null },
          {
            lockedAt: {
              $lt: new Date(now.getTime() - LOCK_TTL_MS),
            },
          },
        ],
      },
      {
        $set: {
          status: "locked",
          lockedAt: now,
          lockedBy: instanceId,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!job) break;

    claimed.push(job as unknown as Job);
    remaining -= 1;
  }

  return claimed;
}

/** Mark a job as completed. */
export async function completeJob(jobId: unknown): Promise<void> {
  const db = await collection("jobs");
  const now = new Date();
  await db.updateOne(
    { _id: toObjectId(String(jobId)) },
    {
      $set: {
        status: "completed",
        lockedAt: null,
        lockedBy: null,
        completedAt: now,
        updatedAt: now,
      },
    },
  );
}

/** Mark a job as failed (dead letter) after max attempts. */
export async function failJob(jobId: unknown, error: string): Promise<void> {
  const db = await collection("jobs");
  const now = new Date();
  await db.updateOne(
    { _id: toObjectId(String(jobId)) },
    {
      $set: {
        status: "failed",
        lastError: error,
        lockedAt: null,
        lockedBy: null,
        updatedAt: now,
      },
    },
  );
}

/** Schedule a job for retry with exponential backoff. */
export async function retryJob(jobId: unknown, error: string): Promise<void> {
  const db = await collection("jobs");
  const now = new Date();
  const job = await db.findOne({ _id: toObjectId(String(jobId)) });
  if (!job) return;

  const attempts = Number(job.attempts ?? 0) + 1;
  if (attempts >= Number(job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
    await db.updateOne(
      { _id: toObjectId(String(jobId)) },
      {
        $set: {
          status: "failed",
          lastError: error,
          attempts,
          lockedAt: null,
          lockedBy: null,
          updatedAt: now,
        },
      },
    );
    return;
  }

  await db.updateOne(
    { _id: toObjectId(String(jobId)) },
    {
      $set: {
        status: "pending",
        attempts,
        lastError: error,
        nextRunAt: new Date(now.getTime() + backoffMs(attempts)),
        lockedAt: null,
        lockedBy: null,
        updatedAt: now,
      },
    },
  );
}

/** List jobs with optional filtering (for admin UI / debugging). */
export async function listJobs(args: {
  type?: JobType;
  status?: JobStatus;
  limit?: number;
}): Promise<Job[]> {
  const db = await collection("jobs");
  const filter: Record<string, unknown> = {};
  if (args.type) filter.type = args.type;
  if (args.status) filter.status = args.status;
  const docs = await db
    .find(filter)
    .sort({ nextRunAt: 1, createdAt: -1 })
    .limit(args.limit ?? 100)
    .toArray();
  return docs as unknown as Job[];
}

/** Count jobs by type and status. */
export async function countJobs(): Promise<Record<string, number>> {
  const db = await collection("jobs");
  const pipeline = [
    { $group: { _id: { type: "$type", status: "$status" }, count: { $sum: 1 } } },
  ];
  const rows = await db.aggregate(pipeline).toArray();
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row._id.type}:${row._id.status}`;
    result[key] = row.count;
  }
  return result;
}
