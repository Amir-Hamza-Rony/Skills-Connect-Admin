import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { NextRequest } from "next/server";
import { POST as processJobs } from "@/app/api/cron/process-jobs/route";
import {
  enqueueJob,
  claimJobs,
  completeJob,
  failJob,
  retryJob,
  listJobs,
  countJobs,
} from "@/lib/jobs";
import { getDb } from "@/lib/db";
import { ObjectId } from "mongodb";
import { makeSuperAdminToken, makeBDCToken, authedRequest } from "./helpers";

async function json(res: Response) {
  return res.json() as Promise<any>;
}

function makeJobRequest(body?: unknown) {
  return authedRequest("POST", "/api/cron/process-jobs", body);
}

describe("Phase 8C-2 — Background jobs", () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.collection("jobs").deleteMany({});
  });

  afterEach(async () => {
    const db = await getDb();
    await db.collection("jobs").deleteMany({});
  });

  describe("enqueueJob / claimJobs / completeJob / failJob / retryJob", () => {
    it("enqueues a pending job", async () => {
      const result = await enqueueJob({
        type: "qb_sync",
        payload: { entityType: "invoice", entityId: "inv-1" },
        idempotencyKey: "qb-sync-job:inv-1",
      });
      expect(result).toBeTruthy();
      expect(result!.id).toBeDefined();

      const jobs = await listJobs({ type: "qb_sync" });
      expect(jobs.length).toBe(1);
      expect(jobs[0].status).toBe("pending");
      expect(jobs[0].attempts).toBe(0);
    });

    it("enforces idempotency — duplicate idempotencyKey returns null", async () => {
      await enqueueJob({
        type: "qb_sync",
        payload: { entityType: "invoice", entityId: "inv-1" },
        idempotencyKey: "qb-sync-job:inv-1",
      });
      const dup = await enqueueJob({
        type: "qb_sync",
        payload: { entityType: "invoice", entityId: "inv-1" },
        idempotencyKey: "qb-sync-job:inv-1",
      });
      expect(dup).toBeNull();

      const jobs = await listJobs({ type: "qb_sync" });
      expect(jobs.length).toBe(1);
    });

    it("claims due pending jobs", async () => {
      const past = new Date(Date.now() - 1000);
      const future = new Date(Date.now() + 100000);
      await enqueueJob({ type: "qb_sync", payload: {}, nextRunAt: past });
      await enqueueJob({ type: "qb_sync", payload: {}, nextRunAt: future });

      const claimed = await claimJobs({ batchSize: 10, now: new Date() });
      expect(claimed.length).toBe(1);
      expect(claimed[0].status).toBe("locked");
      expect(claimed[0].lockedBy).toBeTruthy();
    });

    it("does not claim not-yet-due jobs", async () => {
      const future = new Date(Date.now() + 100000);
      await enqueueJob({ type: "qb_sync", payload: {}, nextRunAt: future });

      const claimed = await claimJobs({ batchSize: 10, now: new Date() });
      expect(claimed.length).toBe(0);
    });

    it("completes a job", async () => {
      const result = await enqueueJob({ type: "qb_sync", payload: {} });
      const claimed = await claimJobs({ batchSize: 10, now: new Date() });
      await completeJob(claimed[0]._id);

      const jobs = await listJobs({ type: "qb_sync" });
      expect(jobs[0].status).toBe("completed");
      expect(jobs[0].completedAt).toBeTruthy();
    });

    it("fails a job after max attempts", async () => {
      const result = await enqueueJob({
        type: "qb_sync",
        payload: {},
        maxAttempts: 1,
      });
      const claimed = await claimJobs({ batchSize: 10, now: new Date() });
      await failJob(claimed[0]._id, "boom");

      const jobs = await listJobs({ type: "qb_sync" });
      expect(jobs[0].status).toBe("failed");
      expect(jobs[0].lastError).toBe("boom");
    });

    it("retries a job with backoff when attempts remain", async () => {
      const result = await enqueueJob({
        type: "qb_sync",
        payload: {},
        maxAttempts: 3,
      });
      const claimed = await claimJobs({ batchSize: 10, now: new Date() });
      await retryJob(claimed[0]._id, "boom");

      const jobs = await listJobs({ type: "qb_sync" });
      expect(jobs[0].status).toBe("pending");
      expect(jobs[0].attempts).toBe(1);
      expect(jobs[0].nextRunAt).toBeTruthy();
    });

    it("dead-letters a job when max attempts reached", async () => {
      const result = await enqueueJob({
        type: "qb_sync",
        payload: {},
        maxAttempts: 1,
      });
      const claimed = await claimJobs({ batchSize: 10, now: new Date() });
      await retryJob(claimed[0]._id, "boom");

      const jobs = await listJobs({ type: "qb_sync" });
      expect(jobs[0].status).toBe("failed");
    });

    it("counts jobs by type and status", async () => {
      await enqueueJob({ type: "qb_sync", payload: {} });
      await enqueueJob({ type: "invoice_sync", payload: {} });
      const counts = await countJobs();
      expect(counts["qb_sync:pending"]).toBe(1);
      expect(counts["invoice_sync:pending"]).toBe(1);
    });
  });

  describe("POST /api/cron/process-jobs", () => {
    it("requires authentication", async () => {
      const res = await processJobs(
        new NextRequest("http://localhost/api/cron/process-jobs", {
          method: "POST",
        }),
      );
      expect(res.status).toBe(401);
    });

    it("requires settings.manage permission", async () => {
      const bdcToken = authedRequest("POST", "/api/cron/process-jobs", undefined, makeBDCToken());
      const res = await processJobs(bdcToken);
      expect(res.status).toBe(403);
    });

    it("processes no jobs when queue is empty", async () => {
      const res = await processJobs(makeJobRequest());
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ok).toBe(true);
      expect(body.claimed).toBe(0);
      expect(body.completed).toBe(0);
    });

    it("processes due jobs and completes them", async () => {
      const past = new Date(Date.now() - 1000);
      await enqueueJob({
        type: "qb_sync",
        payload: { entityType: "invoice", entityId: "inv-1" },
        nextRunAt: past,
      });

      const res = await processJobs(makeJobRequest());
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.claimed).toBe(1);
      expect(body.completed).toBe(1);
      expect(body.failed).toBe(0);

      const jobs = await listJobs({ type: "qb_sync" });
      expect(jobs[0].status).toBe("completed");
    });

    it("does not claim not-yet-due jobs", async () => {
      const future = new Date(Date.now() + 100000);
      await enqueueJob({ type: "qb_sync", payload: {}, nextRunAt: future });

      const res = await processJobs(makeJobRequest());
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.claimed).toBe(0);
    });

    it("respects batch size limit", async () => {
      const past = new Date(Date.now() - 1000);
      for (let i = 0; i < 5; i++) {
        await enqueueJob({
          type: "qb_sync",
          payload: { idx: i },
          nextRunAt: past,
          idempotencyKey: `qb-sync-job:batch-${i}`,
        });
      }

      const res = await processJobs(
        authedRequest("POST", "/api/cron/process-jobs?batchSize=2"),
      );
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.claimed).toBe(2);
    });
  });
});
