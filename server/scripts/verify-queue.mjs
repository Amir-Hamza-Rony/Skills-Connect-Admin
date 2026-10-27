#!/usr/bin/env node
/**
 * Live verification of the B5 queue (BACKEND-PLAN B5).
 *
 * The whole suite runs with Redis absent, because the dev machine did not have
 * Docker — which means the BullMQ path has never actually executed. Everything
 * green in CI was the *inline fallback*. This script proves the real thing:
 * enqueue → Redis → worker picks it up → handler runs → job completes.
 *
 * Run it once Redis is up:
 *
 *   docker compose up -d
 *   npm run server:verify-queue
 *
 * Exits non-zero on the first failed check, so it is usable in CI.
 */

// ioredis ships CommonJS, so its named export is not visible in native ESM.
import IORedis from "ioredis";

const { createClient } = IORedis;

/**
 * Deliberately NOT `qb-sync`. A dev server running on the same Redis already has
 * a worker on that queue, and it will consume the probe job before this script's
 * worker does — the symptom is `handled=0` and a test that passes only when no
 * server is running. A separate queue makes the check independent of whatever
 * else is connected.
 */
const QUEUE_NAME = "qb-sync-verify";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const JOB = "verify-queue-probe";

let pass = 0;
let fail = 0;

function check(label, ok, extra = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} ${extra}`);
  }
}

/** Waits for `predicate` to hold, polling. Returns the final value. */
async function waitFor(predicate, { timeoutMs = 15_000, everyMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return value;
}

async function main() {
  console.log(`\nB5 queue verification — ${REDIS_URL}\n`);

  /* ---------------------------- 1. Redis ---------------------------- */
  // Bounded connect: the client retries a refused connection indefinitely by
  // default, so without this the script hangs forever on a machine without
  // Docker instead of printing the one line that explains what to do.
  const withoutScheme = REDIS_URL.replace(/^rediss?:\/\//, "");
const [host, portPart] = withoutScheme.split(":");
const redis = createClient({
    host: host || "127.0.0.1",
    port: Number(portPart ?? 6379),
    connectTimeout: 2_000,
    // BullMQ blocks on commands that wait indefinitely, so it requires this to
    // be null — passing 1 throws "maxRetriesPerRequest must be null". An outage
    // is kept bounded by retryStrategy instead.
    maxRetriesPerRequest: null,
    retryStrategy: (times) => (times > 2 ? null : Math.min(times * 100, 500)),
    lazyConnect: true,
  });
  redis.on("error", (err) => {
    if (fail === 0) console.log(`  Redis error: ${err.message}`);
  });

  let connected = false;
  try {
    await redis.connect();
    connected = true;
    const pong = await redis.ping();
    check("Redis is reachable and responds to PING", pong === "PONG", `got ${pong}`);
  } catch (err) {
    check(
      "Redis is reachable",
      false,
      `\n        ${err.message}\n        Start it with:  docker compose up -d`,
    );
    return;
  }

  /* ------------------------- 2. Job id dedupe ------------------------ */
  // The pre-flight checks above used one connection; BullMQ is handed the very
  // same client so there is a single pool to close at the end.

  const { Queue, Worker, QueueEvents } = await import("bullmq");

  // An already-constructed client, not options — BullMQ cannot build its own
  // from connection options in native ESM.
  const connection = redis;
  const queue = new Queue(QUEUE_NAME, { connection });
  const queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  await queueEvents.waitUntilReady();

  /* ---------------------- 3. A worker consumes ---------------------- */
  let handled = 0;
  let handlerError = null;

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      handled += 1;
      if (job.data.probe !== true) handlerError = new Error("payload lost in transit");
    },
    { connection },
  );

  // Fail fast rather than hanging if the worker cannot start.
  const workerReady = await waitFor(() => worker.isRunning(), { timeoutMs: 10_000 });
  check("a BullMQ worker starts and begins polling", Boolean(workerReady));

  /* ------------------------- 4. Enqueue + run ------------------------ */
  const job = await queue.add(JOB, { probe: true }, { attempts: 1, removeOnComplete: false });
  check("a job is accepted by the queue", Boolean(job.id));

  const completed = await waitFor(() => handled > 0, { timeoutMs: 15_000 });
  check("the worker picks the job up and runs the handler", Boolean(completed), `handled=${handled}`);
  check("the payload survives the round trip", handlerError === null, handlerError?.message ?? "");

  const state = await job.getState();
  check("the job is marked completed", state === "completed", `state=${state}`);

  /* ---------------- 5. The same jobId is deduplicated ---------------- */
  // This is the half of the idempotency story that only Redis can prove: the
  // unique MongoDB key stops a second *record*, but the jobId is what stops a
  // second *enqueue* while the first is still waiting.
  const first = await queue.add(JOB, { probe: true }, { jobId: "verify-queue-dedupe" });
  const second = await queue.add(JOB, { probe: true }, { jobId: "verify-queue-dedupe" });
  check("a jobId identifies the job", first.id === "verify-queue-dedupe", `got ${first.id}`);
  check("re-adding the same jobId does not create a second job", second.id === first.id);

  /* --------------------------- 6. Depth ----------------------------- */
  const counts = await queue.getJobCounts("waiting", "active", "failed");
  check("queue depth is readable", typeof counts.waiting === "number", JSON.stringify(counts));

  /* --------------------------- Cleanup ------------------------------ */
  // A leftover job would be picked up by a worker on the next run, so the
  // script must leave the queue exactly as it found it — empty.
  await queue.obliterate({ force: true });
  const after = await queue.getJobCounts("waiting", "active", "failed");
  check(
    "the queue is left empty for the next run",
    after.waiting === 0 && after.active === 0 && after.failed === 0,
    JSON.stringify(after),
  );

  await worker.close();
  await queueEvents.close();
  await queue.close();
  await redis.quit().catch(() => {});
}

/* -------------------------------------------------------------------- */

try {
  await main();
} catch (err) {
  fail += 1;
  console.log(`\n  FAIL  unexpected error: ${err?.message ?? err}`);
}

console.log(`\n${"=".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);