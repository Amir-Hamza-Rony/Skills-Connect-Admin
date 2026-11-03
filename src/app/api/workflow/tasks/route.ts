/**
 * GET /api/workflow/tasks — optionally filtered by order, assignee or status.
 * PATCH /api/workflow/tasks/[id] — reassign, reschedule or complete a task.
 * POST /api/workflow/tasks — add a manual task to an order.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId, toObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const VALID_STATUSES = ["Todo", "In Progress", "Done", "Blocked"];
const VALID_PRIORITIES = ["Low", "Medium", "High"];

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

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

    const taskOid = safeObjectId(id);
    if (!taskOid) return invalidId();
    const actor = (req as AuthedRequest).auth!;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const { status, assigneeId, dueDate, priority } = body;

    const tasks = await collection("workflow-tasks");
    const task = await tasks.findOne({ _id: taskOid });
    if (!task) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Task not found." } }, { status: 404 });

    const before = {
      status: task.status,
      assigneeId: task.assigneeId ? String(task.assigneeId) : null,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
      priority: task.priority,
    };

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const historyEntries: Array<Record<string, unknown>> = [];

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: `Invalid status: ${status}` } },
          { status: 400 },
        );
      }
      if (status !== task.status) {
        set.status = status;
        historyEntries.push({ field: "status", before: String(before.status), after: status });
      }
    }

    if (assigneeId !== undefined) {
      const nextAssignee = assigneeId ? safeObjectId(assigneeId) : null;
      if (assigneeId && !nextAssignee) return invalidId();
      set.assigneeId = nextAssignee;
      historyEntries.push({ field: "assigneeId", before: before.assigneeId, after: assigneeId });
    }

    let parsedDueDate: Date | null = null;
    if (dueDate !== undefined) {
      parsedDueDate = dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null;
      if (parsedDueDate && Number.isNaN(parsedDueDate.getTime())) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid dueDate." } },
          { status: 400 },
        );
      }
      set.dueDate = parsedDueDate;
      historyEntries.push({ field: "dueDate", before: before.dueDate, after: dueDate });
    }

    if (priority !== undefined) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: `Invalid priority: ${priority}` } },
          { status: 400 },
        );
      }
      if (priority !== task.priority) {
        set.priority = priority;
        historyEntries.push({ field: "priority", before: String(before.priority ?? ""), after: priority });
      }
    }

    if (historyEntries.length === 0) {
      return NextResponse.json({ error: { code: "NO_CHANGES", message: "No changes supplied." } }, { status: 400 });
    }

    const now = new Date();
    historyEntries.forEach((e) => { e.timestamp = now; e.actorId = actor.userId; });

    await tasks.updateOne(
      { _id: taskOid },
      { $set: set, $push: { history: { $each: historyEntries } } as any },
    );

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "workflow-task",
      entityId: String(id),
      action: "update",
      before,
      after: {
        status: set.status ?? task.status,
        assigneeId: set.assigneeId !== undefined ? (set.assigneeId ? String(set.assigneeId) : null) : before.assigneeId,
        dueDate: set.dueDate !== undefined ? (set.dueDate ? new Date(set.dueDate as any).toISOString() : null) : before.dueDate,
        priority: set.priority ?? task.priority,
      },
    });

    return NextResponse.json({ ok: true, changes: historyEntries });
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