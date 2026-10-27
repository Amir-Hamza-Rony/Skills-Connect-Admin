import { Router } from "express";
import { z } from "zod";

import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { Types } from "mongoose";

import { WorkflowTask, type WorkflowTaskAttrs, type WorkflowTaskLean } from "../models/workflow-task.model.js";
import { recordAudit } from "../services/audit.service.js";
import { isTaskStatus } from "../types/workflow.js";

export const workflowRouter: Router = Router();

/**
 * The workflow board is an operational surface, so it is gated on
 * `orders.view` — the same permission that lets someone see the orders the
 * tasks belong to. Changing a task needs `orders.manage`, matching the mutation
 * rules everywhere else.
 */
workflowRouter.use(requireAuth);

function toTaskDTO(doc: WorkflowTaskLean) {
  return {
    id: String(doc._id),
    orderId: String(doc.orderId),
    stage: doc.stage,
    title: doc.title,
    assigneeId: doc.assigneeId ? String(doc.assigneeId) : null,
    dueDate: doc.dueDate ? doc.dueDate.toISOString().slice(0, 10) : null,
    status: doc.status,
    priority: doc.priority,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** `GET /workflow/tasks` — optionally filtered by order, assignee or status. */
workflowRouter.get(
  "/tasks",
  requirePermission("orders.view"),
  async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (typeof req.query.orderId === "string" && Types.ObjectId.isValid(req.query.orderId)) {
      filter.orderId = new Types.ObjectId(req.query.orderId);
    }
    if (typeof req.query.assigneeId === "string" && Types.ObjectId.isValid(req.query.assigneeId)) {
      filter.assigneeId = new Types.ObjectId(req.query.assigneeId);
    }
    if (typeof req.query.status === "string" && isTaskStatus(req.query.status)) {
      filter.status = req.query.status;
    }

    const tasks = await WorkflowTask.find(filter).sort({ dueDate: 1, createdAt: -1 }).lean<
      WorkflowTaskLean[]
    >();
    res.json({ tasks: tasks.map(toTaskDTO) });
  },
);

const patchBody = z.object({
  status: z.enum(["Todo", "In Progress", "Done", "Blocked"]).optional(),
  assigneeId: z.string().max(24).nullable().optional(),
  dueDate: z.string().max(10).nullable().optional(),
  priority: z.enum(["Low", "Medium", "High"]).optional(),
});

/** `PATCH /workflow/tasks/:id` — reassign, reschedule or complete a task. */
workflowRouter.patch(
  "/tasks/:id",
  requirePermission("orders.manage"),
  async (req, res) => {
    const body = patchBody.parse(req.body);
    if (Object.keys(body).length === 0) {
      res.status(400).json({ error: { code: "NO_CHANGES", message: "No changes supplied." } });
      return;
    }

    const task = await WorkflowTask.findById(param(req, "id"));
    if (!task) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }

    const before = { status: task.status, assigneeId: task.assigneeId, dueDate: task.dueDate };

    if (body.status !== undefined) task.status = body.status;
    if (body.assigneeId !== undefined) {
      task.assigneeId = body.assigneeId ? new Types.ObjectId(body.assigneeId) : null;
    }
    if (body.dueDate !== undefined) {
      task.dueDate = body.dueDate ? new Date(`${body.dueDate}T00:00:00.000Z`) : null;
    }
    if (body.priority !== undefined) task.priority = body.priority;
    await task.save();

    await recordAudit({
      actorId: req.auth!.userId,
      actorEmail: req.auth!.email,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
      requestId: typeof req.id === "string" ? req.id : null,
      action: "task.update",
      entityType: "task",
      entityId: task.id,
      before: {
        status: before.status,
        assigneeId: before.assigneeId ? String(before.assigneeId) : null,
        dueDate: before.dueDate ? before.dueDate.toISOString().slice(0, 10) : null,
      },
      after: {
        status: task.status,
        assigneeId: task.assigneeId ? String(task.assigneeId) : null,
        dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
      },
    });

    res.json({ task: toTaskDTO(task.toObject() as WorkflowTaskLean) });
  },
);

/** `POST /workflow/tasks` — add a manual task to an order. */
workflowRouter.post(
  "/tasks",
  requirePermission("orders.manage"),
  async (req, res) => {
    const body = z
      .object({
        orderId: z.string().min(1),
        stage: z.string().trim().min(1).max(60),
        title: z.string().trim().min(1).max(200),
        assigneeId: z.string().max(24).nullable().optional(),
        dueDate: z.string().max(10).nullable().optional(),
        priority: z.enum(["Low", "Medium", "High"]).optional(),
      })
      .parse(req.body);

    const task = await WorkflowTask.create({
      orderId: new Types.ObjectId(body.orderId),
      stage: body.stage,
      title: body.title,
      assigneeId: body.assigneeId ? new Types.ObjectId(body.assigneeId) : null,
      dueDate: body.dueDate ? new Date(`${body.dueDate}T00:00:00.000Z`) : null,
      status: "Todo",
      priority: body.priority ?? "Medium",
    });

    await recordAudit({
      actorId: req.auth!.userId,
      actorEmail: req.auth!.email,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
      requestId: typeof req.id === "string" ? req.id : null,
      action: "task.create",
      entityType: "task",
      entityId: task.id,
      after: { orderId: body.orderId, title: task.title, stage: task.stage },
    });

    res.status(201).json({ task: toTaskDTO(task.toObject() as WorkflowTaskLean) });
  },
);

export type { WorkflowTaskAttrs };
