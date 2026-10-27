import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

/**
 * B1 acceptance: the app must be mountable and answer `/health` without a live
 * database — integration tests run against the app, not a listening port.
 */
describe("GET /health (liveness)", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  it("returns 200 with the expected envelope", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "skills-connect-admin-api",
      environment: "test",
    });
  });

  it("reports database state without throwing when Mongo is unreachable", async () => {
    const res = await request(app).get("/health");

    // No Atlas connection in tests, so this must degrade rather than 500.
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("disconnected");
  });

  it("exposes a numeric uptime and an ISO timestamp", async () => {
    const res = await request(app).get("/health");

    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("sets a correlation id that is echoed on the response", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("reuses a caller-supplied x-request-id", async () => {
    const res = await request(app).get("/health").set("x-request-id", "test-correlation-123");
    expect(res.headers["x-request-id"]).toBe("test-correlation-123");
  });
});

describe("GET /health/ready (readiness)", () => {
  it("returns 503 while the database is down", async () => {
    const app = createApp();
    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready" });
  });
});

describe("unmatched routes", () => {
  it("returns a structured 404 instead of Express HTML", async () => {
    const app = createApp();
    const res = await request(app).get("/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.requestId).toBeDefined();
  });
});

describe("security headers", () => {
  it("does not advertise the framework", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("applies helmet defaults", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("body parsing", () => {
  it("rejects malformed JSON with a 400 envelope", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send("{not-json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MALFORMED_JSON");
  });
});