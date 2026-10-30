/**
 * GET /api/workflow/tasks — optionally filtered by order, assignee or status.
 * PATCH /api/workflow/tasks/[id] — reassign, reschedule or complete a task.
 * POST /api/workflow/tasks — add a manual task to an order.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

const VALID_STATUSES = ["Todo", "In Progress", "Done", "Blocked"];
const VALID_PRIORITIES = ["Low", "Medium", "High"];

/** `GET /api/workflow/tasks` — optionally filtered by order, assignee or status. */
export const GET = withAuth("orders.view",
  async (req) => {
    const { searchParams } = req.nextUrl;
    const filter: Record<string, unknown> = {};

    const orderId = searchParams.get("orderId");
    const assigneeId = searchParams.get("assigneeId");
    const status = searchParams.get("status");

    if (orderId) filter.orderId = toObjectId(orderId);
    if (assigneeId) filter.assigneeId = toObjectId(assigneeId);
    if (status && VALID_STATUSES.includes(status)) filter.status = status;

    const tasksColl = await collection("workflow-tasks");
    const tasks = await tasksColl.find(filter).sort({ dueDate: 1, createdAt: -1 }).toArray();

    return NextResponse.json({
      tasks: tasks.map((d: any) => ({
        id: String(d._id),
        orderId: String(d.orderId),
        stage: d.stage,
        title: d.title,
        assigneeId: d.assigneeId ? String(d.assigneeId) : null,
        dueDate: d.dueDate,
        status: d.status,
        priority: d.priority,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  },
);

/** `PATCH /api/workflow/tasks/[id]` — reassign, reschedule or complete a task. */
export const PATCH = withAuth("orders.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const { status, assigneeId, dueDate, priority } = await req.json();

    const tasks = await collection("workflow-tasks");
    const task = await tasks.findOne({ _id: toObjectId(id) });
    if (!task) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Task not found." } }, { status: 404 });

    const before = { status: task.status, assigneeId: task.assigneeId ? String(task.assigneeId) : null, dueDate: task.dueDate as any };

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const changes: Array<Record<string, unknown>> = [];

    if (status !== undefined && VALID_STATUSES.includes(status) && status !== task.status) {
      set.status = status;
      changes.push({ field: "status", before: String(before.status), after: status });
    }
    if (assigneeId !== undefined) {
      set.assigneeId = assigneeId ? toObjectId(assigneeId) : null;
      changes.push({ field: "assigneeId", before: before.assigneeId, after: assigneeId });
    }
    if (dueDate !== undefined) {
      set.dueDate = dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null;
      changes.push({ field: "dueDate", before: before.dueDate, after: dueDate });
    }
    if (priority !== undefined && VALID_PRIORITIES.includes(priority) && priority !== task.priority as any) {
      set.priority = priority;
      changes.push({ field: "priority", before: String((before as any).priority ?? ""), after: priority });
    }

    if (Object.keys(set).length <= 1) {
      return NextResponse.json({ error: { code: "NO_CHANGES", message: "No changes supplied." } }, { status: 400 });
    }

    await tasks.updateOne({ _id: toObjectId(id) }, { $set: set });

    return NextResponse.json({ ok: true });
  },
);

/** `POST /api/workflow/tasks` — add a manual task to an order. */
export const POST = withAuth("orders.manage",
  async (req) => {
    const { orderId, stage, title, assigneeId, dueDate, priority } = await req.json();

    if (!orderId || !stage || !title) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "orderId, stage, and title are required." } }, { status: 400 });
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: toObjectId(orderId) });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    const now = new Date();
    const resultColl = await collection("workflow-tasks");
    const result = await resultColl.insertOne({
      orderId: toObjectId(orderId),
      stage,
      title,
      assigneeId: assigneeId ? toObjectId(assigneeId) : null,
      dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null,
      status: "Todo",
      priority: priority ?? "Medium",
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      task: { id: String(result.insertedId), orderId, stage, title, status: "Todo", priority: priority ?? "Medium" },
    }, { status: 201 });
  },
);