import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { Document, DocumentAccessLog } from "../src/models/document.model.js";
import {
  clearTestDb,
  createUser,
  seedOrderMasters,
  seedRoles,
  setupTestDatabase,
} from "./helpers/test-db.js";

/**
 * B4 acceptance criteria (MongoDB storage):
 *  - upload → review → v2 flow (bytes stored in MongoDB)
 *  - the raw file `data` never reaches the client as JSON
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

/** Uploads a file as multipart/form-data. */
async function uploadFile(
  token: string,
  orderId: string,
  type: string,
  content: Buffer | string = Buffer.from("test file content"),
  fileName = "test.pdf",
  mimeType = "application/pdf",
) {
  return request(app)
    .post("/documents/upload")
    .set(authed(token))
    .attach("file", content, fileName)
    .field("orderId", orderId)
    .field("type", type);
}

/* ==================== upload → review → v2 ==================== */

describe("upload → review → v2 flow", () => {
  it("walks a document from upload to review to a second version", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    // 1. Upload a file (multipart, bytes stored directly in MongoDB).
    const up = await uploadFile(
      token,
      orderId,
      "Identity (passport / licence)",
      Buffer.from("passport scan bytes"),
      "passport.pdf",
      "application/pdf",
    );

    expect(up.status).toBe(201);
    expect(up.body.document.status).toBe("Received");
    expect(up.body.document.version).toBe(1);
    expect(up.body.document.fileName).toBe("passport.pdf");
    expect(up.body.document.contentType).toBe("application/pdf");
    expect(up.body.document.sizeBytes).toBeGreaterThan(0);

    // The raw `data` field must never appear in JSON responses.
    expect(JSON.stringify(up.body)).not.toContain("data");

    // 2. Reviewer approves.
    const review = await request(app)
      .patch(`/documents/${up.body.document.id}/review`)
      .set(authed(token))
      .send({ verdict: "Approved" });
    expect(review.status).toBe(200);
    expect(review.body.document.status).toBe("Approved");
    expect(review.body.document.reviewedBy).toEqual(expect.any(String));

    // 3. A second version supersedes the first.
    const up2 = await uploadFile(
      token,
      orderId,
      "Identity (passport / licence)",
      Buffer.from("updated passport scan bytes"),
      "passport-v2.pdf",
      "application/pdf",
    );
    expect(up2.status).toBe(201);
    expect(up2.body.document.version).toBe(2);

    const list = await request(app).get(`/orders/${orderId}/documents`).set(authed(token));
    expect(list.status).toBe(200);
    const versions = list.body.documents
      .filter((d: { type: string }) => d.type === "Identity (passport / licence)")
      .map((d: { version: number; status: string }) => ({ version: d.version, status: d.status }));

    expect(versions).toContainEqual({ version: 1, status: "Superseded" });
    expect(versions).toContainEqual({ version: 2, status: "Received" });
  });
});

/* ==================== file data never leaves as JSON ==================== */

describe("file data containment", () => {
  it("is absent from every JSON API response", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await uploadFile(
      token,
      orderId,
      "USI transcript",
      Buffer.from("transcript content"),
      "transcript.pdf",
      "application/pdf",
    );

    expect(JSON.stringify(up.body)).not.toContain("data");

    const list = await request(app).get(`/orders/${orderId}/documents`).set(authed(token));
    expect(JSON.stringify(list.body)).not.toContain("data");
  });

  it("is stored in the database as a Buffer", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    await uploadFile(
      token,
      orderId,
      "USI transcript",
      Buffer.from("transcript content bytes here"),
      "transcript.pdf",
      "application/pdf",
    );

    const list = await request(app).get(`/orders/${orderId}/documents`).set(authed(token));
    const docId = list.body.documents[0].id;

    const doc = await Document.findById(docId).lean();
    expect(doc?.data).toBeInstanceOf(Buffer);
    expect(Buffer.compare(doc!.data, Buffer.from("transcript content bytes here"))).toBe(0);
  });
});

/* ==================== download ==================== */

describe("document download", () => {
  it("streams stored bytes with correct content type", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await uploadFile(
      token,
      orderId,
      "USI transcript",
      Buffer.from("download me please"),
      "transcript.pdf",
      "application/pdf",
    );

    const down = await request(app)
      .get(`/documents/${up.body.document.id}/download`)
      .set(authed(token));

    expect(down.status).toBe(200);
    expect(down.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.compare(down.body, Buffer.from("download me please"))).toBe(0);
    expect(down.headers["content-disposition"]).toContain("transcript.pdf");
  });

  it("refuses download before the file is received", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await uploadFile(
      token,
      orderId,
      "USI transcript",
      Buffer.from("content"),
      "transcript.pdf",
      "application/pdf",
    );
    // Upload sets status to "Received" directly; to test "Not Received" path,
    // we directly create a document with status "Not Received".
    const doc = await Document.create({
      orderId,
      clientId: new (require("mongoose").Types.ObjectId)(),
      type: "USI transcript",
      version: 1,
      fileName: "x.pdf",
      contentType: "application/pdf",
      sizeBytes: 1,
      data: Buffer.alloc(1),
      status: "Not Received",
    });

    const down = await request(app)
      .get(`/documents/${doc.id}/download`)
      .set(authed(token));

    expect(down.status).toBe(422);
    expect(down.body.error.code).toBe("NOT_RECEIVED");
  });
});

/* ==================== access logging ==================== */

describe("document access logging", () => {
  it("records an upload, a download and a review", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await uploadFile(
      token,
      orderId,
      "USI transcript",
      Buffer.from("content"),
      "transcript.pdf",
      "application/pdf",
    );
    const docId = up.body.document.id as string;

    await request(app)
      .get(`/documents/${docId}/download`)
      .set(authed(token));
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
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    await uploadFile(
      token,
      orderId,
      "USI transcript",
      Buffer.from("content"),
      "transcript.pdf",
      "application/pdf",
    );

    const rows = await DocumentAccessLog.find({}).lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.action).toBe("upload");
  });
});

/* ==================== guards ==================== */

describe("document guards", () => {
  it("rejects an unallowed content type", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const res = await uploadFile(
      token,
      orderId,
      "USI transcript",
      Buffer.from("x"),
      "evil.exe",
      "application/x-msdownload",
    );

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CONTENT_TYPE_NOT_ALLOWED");
  });

  it("rejects an empty file", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const res = await uploadFile(token, orderId, "USI transcript", Buffer.alloc(0), "empty.pdf", "application/pdf");

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("FILE_EMPTY");
  });

  it("requires a rejection reason", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const up = await uploadFile(
      token,
      orderId,
      "USI transcript",
      Buffer.from("content"),
      "transcript.pdf",
      "application/pdf",
    );

    const res = await request(app)
      .patch(`/documents/${up.body.document.id}/review`)
      .set(authed(token))
      .send({ verdict: "Rejected" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("REASON_REQUIRED");
  });

  it("refuses to review a document that was never received", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    // Create a document directly with status "Requested" (never received).
    const doc = await Document.create({
      orderId,
      clientId: new (require("mongoose").Types.ObjectId)(),
      type: "USI transcript",
      version: 1,
      fileName: "x.pdf",
      contentType: "application/pdf",
      sizeBytes: 0,
      data: Buffer.alloc(0),
      status: "Requested",
    });

    const res = await request(app)
      .patch(`/documents/${doc.id}/review`)
      .set(authed(token))
      .send({ verdict: "Approved" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NOT_REVIEWABLE");
  });

  it("assigns version numbers so concurrent uploads cannot collide", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const [a, b] = await Promise.all([
      uploadFile(token, orderId, "USI transcript", Buffer.from("a"), "a.pdf", "application/pdf"),
      uploadFile(token, orderId, "USI transcript", Buffer.from("b"), "b.pdf", "application/pdf"),
    ]);

    const versions = [a.body.document?.version, b.body.document?.version].sort();
    expect(versions).toEqual([1, 2]);
  });
});

/* ==================== RBAC ==================== */

describe("RBAC on documents", () => {
  it("lets a Document Reviewer upload but not manage users", async () => {
    const reviewer = await signIn("review@example.com", ["Document Reviewer"]);
    const orderId = await makeOrder(await signIn("admin@example.com"));

    const up = await uploadFile(
      reviewer,
      orderId,
      "USI transcript",
      Buffer.from("content"),
      "transcript.pdf",
      "application/pdf",
    );
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
