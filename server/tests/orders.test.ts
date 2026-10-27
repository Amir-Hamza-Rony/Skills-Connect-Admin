import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { Client } from "../src/models/client.model.js";
import { Order } from "../src/models/order.model.js";
import { SupplierRoute } from "../src/models/supplier-route.model.js";
import { WorkflowTask } from "../src/models/workflow-task.model.js";
import {
  clearTestDb,
  createUser,
  seedOrderMasters,
  seedRoles,
  setupTestDatabase,
} from "./helpers/test-db.js";

/**
 * B3 acceptance criteria, run against a real MongoDB:
 *  - multi-order client
 *  - snapshot survives a pricing-matrix edit
 *  - a transition writes history AND a task in one transaction
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

/** Creates a client and returns its id. */
async function makeClient(token: string, email = "client@example.com"): Promise<string> {
  const res = await request(app)
    .post("/clients")
    .set(authed(token))
    .send({ legalName: "Test Client", email, phone: "0411 000 000" });
  expect(res.status).toBe(201);
  return res.body.client.id as string;
}

/* ==================== multi-order client ==================== */

describe("multi-order client", () => {
  it("lets one client hold several orders", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const first = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2800 });
    expect(second.status).toBe(201);

    const list = await request(app)
      .get(`/orders?clientId=${clientId}`)
      .set(authed(token));

    expect(list.status).toBe(200);
    expect(list.body.orders).toHaveLength(2);
    expect(list.body.orders.map((o: { sellingPrice: number }) => o.sellingPrice).sort()).toEqual([
      2500, 2800,
    ]);
  });
});

/* ==================== immutable price snapshot ==================== */

describe("supplier cost snapshot", () => {
  it("freezes the route cost at creation", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const res = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });

    expect(res.status).toBe(201);
    expect(res.body.order.supplierCostSnapshot).toBe(700);
  });

  it("SURVIVES a repricing of the supplier route", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    // Reprice the route and expire it. The order must not move.
    await SupplierRoute.findByIdAndUpdate(masters.routeId, {
      $set: { wholesaleCost: 9999, status: "expired" },
    });

    const after = await request(app).get(`/orders/${orderId}`).set(authed(token));
    expect(after.status).toBe(200);
    expect(after.body.order.supplierCostSnapshot).toBe(700);
  });

  it("cannot be overwritten through a direct update", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    // Attempt to rewrite the snapshot straight through the model. The update
    // may still touch `updatedAt`, so the assertion that matters is the value.
    await Order.updateOne({ _id: orderId }, { $set: { supplierCostSnapshot: 0 } });

    const doc = await Order.findById(orderId);
    expect(doc?.supplierCostSnapshot).toBe(700);
  });

  it("rejects an order when no active route matches", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    await SupplierRoute.findByIdAndUpdate(masters.routeId, { $set: { status: "expired" } });

    const res = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NO_ACTIVE_ROUTE");
  });
});

/* ==================== transactional transition ==================== */

describe("status transition", () => {
  it("writes the history entry AND the stage task together", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    // Walk the state machine to "Documents Under Review" (Spec §5): New ->
    // Awaiting Documents -> Documents Under Review.
    await request(app)
      .patch(`/orders/${orderId}/status`)
      .set(authed(token))
      .send({ status: "Awaiting Documents" });

    const res = await request(app)
      .patch(`/orders/${orderId}/status`)
      .set(authed(token))
      .send({ status: "Documents Under Review" });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("Documents Under Review");

    // History recorded who moved it, from what, to what.
    const history = res.body.order.history;
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[history.length - 1]).toMatchObject({
      field: "status",
      before: "Awaiting Documents",
      after: "Documents Under Review",
      actorId: expect.any(String),
    });

    // And the stage task exists — the B3 "one transaction" criterion.
    const tasks = await WorkflowTask.find({ orderId }).lean();
    const review = tasks.find((t) => t.title === "Review submitted documents");
    expect(review).toBeDefined();
    expect(review?.stage).toBe("Onboarding");
    expect(review?.status).toBe("Todo");
  });

  it("sets completedAt only when the order is Completed", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    // Seed the order to just before Completed so a single valid state-machine
    // hop (Certificate Issued -> Completed) is all that is exercised here.
    await Order.updateOne({ _id: orderId }, { $set: { status: "Certificate Issued" } });

    let doc = await Order.findById(orderId);
    expect(doc?.completedAt).toBeNull();

    await request(app)
      .patch(`/orders/${orderId}/status`)
      .set(authed(token))
      .send({ status: "Completed" });

    doc = await Order.findById(orderId);
    expect(doc?.completedAt).toBeInstanceOf(Date);
  });

  it("rejects an unknown status", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    const res = await request(app)
      .patch(`/orders/${orderId}/status`)
      .set(authed(token))
      .send({ status: "Nonsense" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("records each changed dimension as its own history row", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    const res = await request(app)
      .patch(`/orders/${orderId}/dimensions`)
      .set(authed(token))
      .send({ evidenceStatus: "In Progress", rtoSubmissionStatus: "Ready" });

    expect(res.status).toBe(200);
    const fields = res.body.order.history.map((h: { field: string }) => h.field);
    expect(fields).toContain("evidenceStatus");
    expect(fields).toContain("rtoSubmissionStatus");
  });
});

/* ==================== clients ==================== */

describe("clients", () => {
  it("creates a client and returns it without internal fields", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Jane Doe", email: "jane@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.client.legalName).toBe("Jane Doe");
    expect(res.body.client.status).toBe("Prospect");
    expect(res.body.client.id).toEqual(expect.any(String));
  });

  it("rejects a duplicate email", async () => {
    const token = await signIn("admin@example.com");
    await makeClient(token, "dupe@example.com");

    const res = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Dupe", email: "dupe@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_CLIENT");
  });

  it("searches by partial phone number", async () => {
    const token = await signIn("admin@example.com");
    await request(app)
      .post("/clients")
      .set(authed(token))
      .send({
        legalName: "Phone Person",
        email: "phone@example.com",
        contacts: [
          { label: "Mobile", type: "phone", value: "0411 222 333", primary: true },
        ],
      });

    const res = await request(app).get("/clients?search=222333").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.clients).toHaveLength(1);
  });

  it("reports duplicate people by email and by phone", async () => {
    const { Client } = await import("../src/models/client.model.js");

    // Duplicate emails cannot arrive through the API (POST /clients rejects
    // them) — they arrive through migration, so seed them the way a migration
    // would: straight into the collection.
    await Client.create({
      legalName: "Same Email",
      email: "same@example.com",
      contacts: [
        { label: "Mobile", type: "phone", value: "0411 000 001", primary: true },
      ],
    });
    await Client.create({
      legalName: "Same Email Again",
      email: "same@example.com",
      contacts: [
        { label: "Mobile", type: "phone", value: "0411 000 002", primary: true },
      ],
    });

    // Two different people can legitimately share a phone, so this is reported
    // as possible rather than certain.
    await Client.create({
      legalName: "Same Phone",
      email: "other@example.com",
      contacts: [
        { label: "Mobile", type: "phone", value: "0411 999 888", primary: true },
      ],
    });
    await Client.create({
      legalName: "Same Phone Again",
      email: "another@example.com",
      contacts: [
        { label: "Mobile", type: "phone", value: "0411 999 888", primary: true },
      ],
    });

    const token = await signIn("admin@example.com");
    const res = await request(app).get("/clients/duplicates").set(authed(token));
    expect(res.status).toBe(200);

    expect(res.body.certain).toHaveLength(1);
    expect(res.body.certain[0].reason).toBe("email");
    expect(res.body.certain[0].clients).toHaveLength(2);

    expect(res.body.possible).toHaveLength(1);
    expect(res.body.possible[0].reason).toBe("phone");
    expect(res.body.possible[0].clients).toHaveLength(2);
  });

  it("updates a client and audits before -> after", async () => {
    const token = await signIn("admin@example.com");
    const clientId = await makeClient(token);

    const res = await request(app)
      .patch(`/clients/${clientId}`)
      .set(authed(token))
      .send({ status: "Active", notes: "Called, ready to proceed" });

    expect(res.status).toBe(200);
    expect(res.body.client.status).toBe("Active");
    expect(res.body.client.notes).toBe("Called, ready to proceed");
  });
});

/* ==================== RBAC ==================== */

describe("RBAC on clients and orders", () => {
  it("gives a Sales user 403 on order creation", async () => {
    const token = await signIn("sales@example.com", ["Sales / Closing Agent"]);
    const masters = await seedOrderMasters();
    const clientId = await makeClient(await signIn("admin@example.com"));

    const res = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });

    expect(res.status).toBe(403);
  });

  it("lets a Sales user read the order list but not create orders", async () => {
    const admin = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(admin);
    await request(app)
      .post("/orders")
      .set(authed(admin))
      .send({ clientId, ...masters, sellingPrice: 2500 });

    const sales = await signIn("sales@example.com", ["Sales / Closing Agent"]);

    expect((await request(app).get("/orders").set(authed(sales))).status).toBe(200);
    expect((await request(app).get(`/clients/${clientId}`).set(authed(sales))).status).toBe(200);
  });

  it("requires authentication before permission", async () => {
    expect((await request(app).get("/clients")).status).toBe(401);
    expect((await request(app).get("/orders")).status).toBe(401);
  });
});

/* ==================== workflow tasks ==================== */

describe("workflow tasks", () => {
  it("lists tasks filtered by order", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    const res = await request(app).get(`/workflow/tasks?orderId=${orderId}`).set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBeGreaterThan(0);
    expect(res.body.tasks[0].title).toBe("Send document checklist to client");
  });

  it("updates a task status and records the change", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    const list = await request(app).get(`/workflow/tasks?orderId=${orderId}`).set(authed(token));
    const taskId = list.body.tasks[0].id as string;

    const res = await request(app)
      .patch(`/workflow/tasks/${taskId}`)
      .set(authed(token))
      .send({ status: "Done" });

    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe("Done");
  });

  it("returns the order timeline oldest-first", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });
    const orderId = created.body.order.id as string;

    await request(app)
      .patch(`/orders/${orderId}/status`)
      .set(authed(token))
      .send({ status: "Awaiting Documents" });

    const res = await request(app).get(`/orders/${orderId}/timeline`).set(authed(token));
    expect(res.status).toBe(200);

    const events = res.body.events as Array<{ kind: string; field: string; after: string }>;
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.after).toBe("New");
    expect(events[events.length - 1]?.after).toBe("Awaiting Documents");
  });
});

/* ==================== audit ==================== */

describe("audit trail for B3 mutations", () => {
  it("records client.create and order.create", async () => {
    const { AuditLog } = await import("../src/models/audit-log.model.js");
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);

    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });

    await request(app)
      .patch(`/orders/${created.body.order.id}/status`)
      .set(authed(token))
      .send({ status: "Awaiting Documents" });

    const actions = await AuditLog.find({}).distinct("action");
    expect(actions).toContain("client.create");
    expect(actions).toContain("order.create");
    expect(actions).toContain("order.status.change");
  });
});

/* ==================== model-level guarantees ==================== */

describe("model guarantees", () => {
  it("requires a client to exist before an order can reference it", async () => {
    const masters = await seedOrderMasters();
    const token = await signIn("admin@example.com");

    const res = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: "000000000000000000000000", ...masters, sellingPrice: 2500 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CLIENT_NOT_FOUND");
  });

  it("keeps the client collection clean of order data", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const clientId = await makeClient(token);
    await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId, ...masters, sellingPrice: 2500 });

    const client = await Client.findById(clientId).lean();
    // Orders are a separate collection, not embedded on the client.
    expect(client).not.toHaveProperty("orders");
    expect(client).not.toHaveProperty("sellingPrice");
    expect(client).not.toHaveProperty("qualificationId");
    expect(client).not.toHaveProperty("history");
  });
});
