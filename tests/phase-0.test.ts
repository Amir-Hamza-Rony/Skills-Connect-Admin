import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import {
  POST as createOrder,
  GET as listOrders,
} from "@/app/api/orders/route";
import { GET as getOrder } from "@/app/api/orders/[id]/route";
import { PATCH as updateOrderStatus } from "@/app/api/orders/[id]/status/route";
import { GET as listTasks, PATCH as updateTask } from "@/app/api/workflow/tasks/route";
import { POST as recordPayment, GET as listPayments } from "@/app/api/payments/route";
import { POST as addInstalment } from "@/app/api/payment-plans/[id]/instalments/route";
import { GET as listAudit } from "@/app/api/audit/route";
import { getDb } from "@/lib/db";
import {
  authedRequest,
  clearDb,
  seedClient,
  seedSupplierRoute,
  seedTask,
  seedOrder,
  seedInvoice,
  seedPlan,
  findAuditAction,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

describe("Phase 0 — supplier cost snapshot", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("captures the active supplier route's wholesale cost on order creation", async () => {
    const clientId = await seedClient();
    const qualificationId = new ObjectId();
    const sourceAgentId = new ObjectId();
    const rtoId = new ObjectId();
    await seedSupplierRoute(qualificationId, sourceAgentId, rtoId, 1500);

    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qualificationId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(sourceAgentId),
        rtoId: String(rtoId),
        sellingPrice: 5000,
      }),
    );
    expect(res.status).toBe(201);
    const { order } = await json(res);

    const fetched = await getOrder(
      authedRequest("GET", `/api/orders/${order.id}`),
      { params: { id: order.id } },
    );
    const body = await json(fetched);
    expect(fetched.status).toBe(200);
    expect(body.supplierCostSnapshot).toBe(1500);
  });

  it("rejects order creation when no active supplier route exists", async () => {
    const clientId = await seedClient();
    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(new ObjectId()),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(new ObjectId()),
        rtoId: String(new ObjectId()),
        sellingPrice: 5000,
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("NO_ACTIVE_SUPPLIER_ROUTE");
  });

  it("preserves the original supplier cost when route pricing changes", async () => {
    const clientId = await seedClient();
    const qualificationId = new ObjectId();
    const sourceAgentId = new ObjectId();
    const rtoId = new ObjectId();
    const routeId = await seedSupplierRoute(qualificationId, sourceAgentId, rtoId, 1500);

    const created = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qualificationId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(sourceAgentId),
        rtoId: String(rtoId),
        sellingPrice: 5000,
      }),
    );
    const { order } = await json(created);

    const routes = await (await getDb()).collection("supplier-routes");
    await routes.updateOne({ _id: routeId }, { $set: { wholesaleCost: 9999 } });

    const fetched = await getOrder(authedRequest("GET", `/api/orders/${order.id}`), {
      params: { id: order.id },
    });
    const body = await json(fetched);
    expect(body.supplierCostSnapshot).toBe(1500);
  });

  it("returns 400 for a malformed order id", async () => {
    const res = await getOrder(authedRequest("GET", "/api/orders/not-an-objectid"), {
      params: { id: "not-an-objectid" },
    });
    expect(res.status).toBe(400);
  });
});

describe("Phase 0 — workflow task PATCH", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("updates only the supplied fields and preserves the rest", async () => {
    const { id } = await seedTask();

    const res = await updateTask(
      authedRequest("PATCH", `/api/workflow/tasks/${id}`, {
        status: "Done",
        priority: "High",
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);

    const list = await listTasks(authedRequest("GET", "/api/workflow/tasks"), {
      params: {},
    });
    const body = await json(list);
    const task = body.tasks.find((t: any) => t.id === String(id));
    expect(task.status).toBe("Done");
    expect(task.priority).toBe("High");
    expect(task.stage).toBe("Enrolment");
    expect(task.title).toBe("Collect ID");
  });

  it("rejects an invalid status", async () => {
    const { id } = await seedTask();
    const res = await updateTask(
      authedRequest("PATCH", `/api/workflow/tasks/${id}`, { status: "NotAStatus" }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for a missing task and 400 for a malformed id", async () => {
    const missing = await updateTask(
      authedRequest("PATCH", "/api/workflow/tasks/000000000000000000000000", { status: "Done" }),
      { params: { id: "000000000000000000000000" } },
    );
    expect(missing.status).toBe(404);

    const bad = await updateTask(
      authedRequest("PATCH", "/api/workflow/tasks/bad", { status: "Done" }),
      { params: { id: "bad" } },
    );
    expect(bad.status).toBe(400);
  });

  it("returns 400 when no changes are supplied", async () => {
    const { id } = await seedTask();
    const res = await updateTask(
      authedRequest("PATCH", `/api/workflow/tasks/${id}`, {}),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("NO_CHANGES");
  });
});

describe("Phase 0 — payment allocation", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("allocates a payment against an invoice and prevents over-allocation", async () => {
    const orderId = new ObjectId();
    await seedOrder(orderId);
    const invoiceId = await seedInvoice(new ObjectId(), orderId, 1000);

    const res = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId: String(invoiceId),
        amount: 400,
        date: "2027-01-01",
        method: "Bank Transfer",
        reference: "REF-1",
      }),
    );
    expect(res.status).toBe(201);
    const { payment } = await json(res);
    expect(payment.id).toBeDefined();

    const db = await getDb();
    const stored = await db.collection("payments").findOne({ _id: new ObjectId(payment.id) });
    expect(stored.allocatedAmount).toBe(400);
    expect(stored.status).toBe("Allocated");

    // Over-allocation against the remaining 600 outstanding.
    const over = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId: String(invoiceId),
        amount: 700,
        date: "2027-01-02",
        method: "Bank Transfer",
        reference: "REF-2",
      }),
    );
    expect(over.status).toBe(400);
    expect(await json(over).then((b: any) => b.error.code)).toBe("OVER_ALLOCATION");

    // Exact remaining allocation.
    const final = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId: String(invoiceId),
        amount: 600,
        date: "2027-01-03",
        method: "Bank Transfer",
        reference: "REF-3",
      }),
    );
    expect(final.status).toBe(201);
  });

  it("prevents duplicate allocation via idempotency key", async () => {
    const orderId = new ObjectId();
    await seedOrder(orderId);
    const invoiceId = await seedInvoice(new ObjectId(), orderId, 1000);
    const key = "idem-1";

    const a = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId: String(invoiceId),
        amount: 300,
        date: "2027-01-01",
        method: "Card",
        reference: "REF",
        idempotencyKey: key,
      }),
    );
    expect(a.status).toBe(201);

    const b = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId: String(invoiceId),
        amount: 300,
        date: "2027-01-01",
        method: "Card",
        reference: "REF",
        idempotencyKey: key,
      }),
    );
    expect(b.status).toBe(409);
    expect((await json(b)).error.code).toBe("DUPLICATE_ALLOCATION");
  });

  it("returns 404 for a missing invoice", async () => {
    const orderId = new ObjectId();
    await seedOrder(orderId);
    const res = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId: String(new ObjectId()),
        amount: 100,
        date: "2027-01-01",
        method: "Cash",
        reference: "REF",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid amount and malformed ids", async () => {
    const orderId = new ObjectId();
    await seedOrder(orderId);
    const badAmount = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        amount: -50,
        date: "2027-01-01",
        method: "Cash",
        reference: "REF",
      }),
    );
    expect(badAmount.status).toBe(400);

    const badId = await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: "not-an-id",
        amount: 100,
        date: "2027-01-01",
        method: "Cash",
        reference: "REF",
      }),
    );
    expect(badId.status).toBe(400);
  });
});

describe("Phase 0 — payment plans", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("adds an instalment within the plan total and rejects over-scheduling", async () => {
    const planId = await seedPlan(new ObjectId(), new ObjectId(), 1000);

    const res = await addInstalment(
      authedRequest("POST", `/api/payment-plans/${String(planId)}/instalments`, {
        dueDate: "2027-01-01",
        amount: 400,
      }),
      { params: { id: String(planId) } },
    );
    expect(res.status).toBe(201);

    const over = await addInstalment(
      authedRequest("POST", `/api/payment-plans/${String(planId)}/instalments`, {
        dueDate: "2027-02-01",
        amount: 700,
      }),
      { params: { id: String(planId) } },
    );
    expect(over.status).toBe(400);
    expect((await json(over)).error.code).toBe("OVER_SCHEDULED");
  });

  it("returns 404 for a missing plan and 400 for a malformed id", async () => {
    const missing = await addInstalment(
      authedRequest("POST", "/api/payment-plans/000000000000000000000000/instalments", {
        dueDate: "2027-01-01",
        amount: 100,
      }),
      { params: { id: "000000000000000000000000" } },
    );
    expect(missing.status).toBe(404);

    const bad = await addInstalment(
      authedRequest("POST", "/api/payment-plans/bad/instalments", {
        dueDate: "2027-01-01",
        amount: 100,
      }),
      { params: { id: "bad" } },
    );
    expect(bad.status).toBe(400);
  });
});

describe("Phase 0 — audit logging", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("writes an audit record when an order is created", async () => {
    const clientId = await seedClient();
    const qualificationId = new ObjectId();
    const sourceAgentId = new ObjectId();
    const rtoId = new ObjectId();
    await seedSupplierRoute(qualificationId, sourceAgentId, rtoId, 1500);

    await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qualificationId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(sourceAgentId),
        rtoId: String(rtoId),
        sellingPrice: 5000,
      }),
    );

    const audit = await findAuditAction("order", "create");
    expect(audit).toBeTruthy();
    expect(audit.actorId).toBe("test-user-1");
    expect(audit.entityId).toBeDefined();
    expect(audit.createdAt).toBeDefined();
  });

  it("writes an audit record when a payment is recorded", async () => {
    const orderId = new ObjectId();
    await seedOrder(orderId);
    const invoiceId = await seedInvoice(new ObjectId(), orderId, 1000);

    await recordPayment(
      authedRequest("POST", "/api/payments", {
        orderId: String(orderId),
        invoiceId: String(invoiceId),
        amount: 200,
        date: "2027-01-01",
        method: "Bank Transfer",
        reference: "REF",
      }),
    );

    const audit = await findAuditAction("payment", "create");
    expect(audit).toBeTruthy();
    expect(audit.after.amount).toBe(200);
  });
});
