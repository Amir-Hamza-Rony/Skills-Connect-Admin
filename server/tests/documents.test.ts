import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { Document, DocumentAccessLog } from "../src/models/document.model.js";
import { setStorageOverride } from "../src/integrations/storage/s3.js";
import {
  clearTestDb,
  createUser,
  seedOrderMasters,
  seedRoles,
  setupTestDatabase,
} from "./helpers/test-db.js";

/**
 * B4 acceptance criteria:
 *  - upload → review → v2 flow
 *  - the raw storage key never reaches the client
 *  - access-log rows exist
 */
setupTestDatabase();

const PASSWORD = "CorrectHorseBattery1!";
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await clearTestDb();
  await seedRoles();
});

/**
 * A fake storage adapter.
 *
 * The real key is server-generated and never leaves the server, so a test cannot
 * know it in advance. `existAll()` lets a test say "the file is there" without
 * guessing the key; the default is that nothing exists, which is what the
 * "refuses to confirm" guard needs.
 */
function fakeStorage() {
  const existing = new Set<string>();
  let allExist = false;
  return {
    existing,
    async presignUpload(key: string) {
      return `https://storage.test/upload/${encodeURIComponent(key)}?sig=abc`;
    },
    async presignDownload(key: string) {
      return `https://storage.test/download/${encodeURIComponent(key)}?sig=xyz`;
    },
    async keyExists(key: string) {
      return allExist || existing.has(key);
    },
    /** Test helper: simulate the client having PUT the file. */
    put(key: string) {
      existing.add(key);
    },
    /** Test helper: every key is reported as present. */
    existAll() {
      allExist = true;
    },
  };
}

async function signIn(email: string, roleNames: string[] = ["Super Admin"]): Promise<string> {
  await createUser({ email, password: PASSWORD, roleNames });
  const res = await request(app).post("/auth/login").send({ email, password: PASSWORD });
  return res.body.accessToken as string;
}

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Creates a client + order and returns the order id. */
async function makeOrder(token: string): Promise<string> {
  const masters = await seedOrderMasters();
  const client = await request(app)
    .post("/clients")
    .set(authed(token))
    .send({ legalName: "Doc Client", email: `doc-${Date.now()}@example.com` });
  const order = await request(app)
    .post("/orders")
    .set(authed(token))
    .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });
  return order.body.order.id as string;
}

/* ==================== upload → review → v2 ==================== */

describe("upload → review → v2 flow", () => {
  it("walks a document from upload to review to a second version", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    // 1. Ask for an upload URL.
    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "Identity (passport / licence)", contentType: "image/jpeg" });

    expect(up.status).toBe(201);
    expect(up.body.uploadUrl).toContain("https://storage.test/upload/");
    expect(up.body.document.status).toBe("Not Received");
    expect(up.body.document.version).toBe(1);

    // 2. Client uploads, then confirms.
    storage.existAll();
    const confirm = await request(app)
      .post(`/documents/${up.body.document.id}/confirm-upload`)
      .set(authed(token));
    expect(confirm.status).toBe(200);
    expect(confirm.body.document.status).toBe("Received");

    // 3. Reviewer approves.
    const review = await request(app)
      .patch(`/documents/${up.body.document.id}/review`)
      .set(authed(token))
      .send({ verdict: "Approved" });
    expect(review.status).toBe(200);
    expect(review.body.document.status).toBe("Approved");
    expect(review.body.document.reviewedBy).toEqual(expect.any(String));

    // 4. A second version supersedes the first.
    const up2 = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "Identity (passport / licence)", contentType: "image/jpeg" });
    expect(up2.status).toBe(201);
    expect(up2.body.document.version).toBe(2);

    await request(app)
      .post(`/documents/${up2.body.document.id}/confirm-upload`)
      .set(authed(token));

    const list = await request(app).get(`/orders/${orderId}/documents`).set(authed(token));
    expect(list.status).toBe(200);
    const versions = list.body.documents
      .filter((d: { type: string }) => d.type === "Identity (passport / licence)")
      .map((d: { version: number; status: string }) => ({ version: d.version, status: d.status }));

    expect(versions).toContainEqual({ version: 1, status: "Superseded" });
    expect(versions).toContainEqual({ version: 2, status: "Received" });
  });
});

/* ==================== the storage key never leaves the server ==================== */

describe("storage key containment", () => {
  it("is absent from every API response", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });

    expect(JSON.stringify(up.body)).not.toContain("storageKey");
    expect(JSON.stringify(up.body)).not.toContain("clients/");

    storage.existAll();
    await request(app)
      .post(`/documents/${up.body.document.id}/confirm-upload`)
      .set(authed(token));

    const list = await request(app).get(`/orders/${orderId}/documents`).set(authed(token));
    expect(JSON.stringify(list.body)).not.toContain("storageKey");

    const down = await request(app)
      .get(`/documents/${up.body.document.id}/download-url`)
      .set(authed(token));
    expect(down.status).toBe(200);
    expect(JSON.stringify(down.body)).not.toContain("storageKey");
    expect(down.body.downloadUrl).toContain("https://storage.test/download/");
  });

  it("is present in the database, where it belongs", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });

    const doc = await Document.findById(up.body.document.id).lean();
    expect(doc?.storageKey).toMatch(/^clients\/.*\/v1$/);
  });
});

/* ==================== access logging ==================== */

describe("document access logging", () => {
  it("records an upload, a download and a review", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });
    const docId = up.body.document.id as string;

    storage.existAll();
    await request(app).post(`/documents/${docId}/confirm-upload`).set(authed(token));
    await request(app).get(`/documents/${docId}/download-url`).set(authed(token));
    await request(app)
      .patch(`/documents/${docId}/review`)
      .set(authed(token))
      .send({ verdict: "Approved" });

    const log = await request(app).get(`/documents/${docId}/access-log`).set(authed(token));
    expect(log.status).toBe(200);

    const actions = log.body.events.map((e: { action: string }) => e.action);
    expect(actions).toContain("upload");
    expect(actions).toContain("download");
    expect(actions).toContain("review");

    const download = log.body.events.find((e: { action: string }) => e.action === "download");
    expect(download.actorId).toEqual(expect.any(String));
  });

  it("writes access rows even when the document is never downloaded", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });

    const rows = await DocumentAccessLog.find({ documentId: up.body.document.id }).lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.action).toBe("upload");
  });
});

/* ==================== guards ==================== */

describe("document guards", () => {
  it("refuses to confirm an upload that never happened", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });

    // storage.existAll() deliberately NOT called — the file is not there.
    const confirm = await request(app)
      .post(`/documents/${up.body.document.id}/confirm-upload`)
      .set(authed(token));

    expect(confirm.status).toBe(422);
    expect(confirm.body.error.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("refuses a download before the file is received", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });

    const down = await request(app)
      .get(`/documents/${up.body.document.id}/download-url`)
      .set(authed(token));

    expect(down.status).toBe(422);
    expect(down.body.error.code).toBe("NOT_RECEIVED");
  });

  it("requires a rejection reason", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });
    storage.existAll();
    await request(app).post(`/documents/${up.body.document.id}/confirm-upload`).set(authed(token));

    const res = await request(app)
      .patch(`/documents/${up.body.document.id}/review`)
      .set(authed(token))
      .send({ verdict: "Rejected" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("REASON_REQUIRED");
  });

  it("refuses to review a document that was never received", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });

    const res = await request(app)
      .patch(`/documents/${up.body.document.id}/review`)
      .set(authed(token))
      .send({ verdict: "Approved" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NOT_REVIEWABLE");
  });

  it("assigns version numbers so concurrent uploads cannot collide", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const [a, b] = await Promise.all([
      request(app)
        .post("/documents/upload-url")
        .set(authed(token))
        .send({ orderId, type: "USI transcript", contentType: "application/pdf" }),
      request(app)
        .post("/documents/upload-url")
        .set(authed(token))
        .send({ orderId, type: "USI transcript", contentType: "application/pdf" }),
    ]);

    const versions = [a.body.document?.version, b.body.document?.version].sort();
    expect(versions).toEqual([1, 2]);
  });
});

/* ==================== storage not configured ==================== */

describe("without storage configured", () => {
  it("fails cleanly instead of crashing", async () => {
    setStorageOverride(null);
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const res = await request(app)
      .post("/documents/upload-url")
      .set(authed(token))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("STORAGE_NOT_CONFIGURED");
  });
});

/* ==================== RBAC ==================== */

describe("RBAC on documents", () => {
  it("lets a Document Reviewer upload but not manage users", async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    const reviewer = await signIn("review@example.com", ["Document Reviewer"]);
    const orderId = await makeOrder(await signIn("admin@example.com"));

    const up = await request(app)
      .post("/documents/upload-url")
      .set(authed(reviewer))
      .send({ orderId, type: "USI transcript", contentType: "application/pdf" });
    expect(up.status).toBe(201);

    expect((await request(app).get("/users").set(authed(reviewer))).status).toBe(403);
  });

  it("gives a Sales user 403 on the document list", async () => {
    const sales = await signIn("sales@example.com", ["Sales / Closing Agent"]);
    expect(
      (await request(app).get("/orders/some-id/documents").set(authed(sales))).status,
    ).toBe(403);
  });

  it("requires authentication before permission", async () => {
    expect((await request(app).get("/orders/some-id/documents")).status).toBe(401);
  });
});
