import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

import type { TaskPriority, TaskStatus } from "../types/workflow.js";

/**
 * A unit of work attached to an order ("Chase RTO assessment outcome",
 * "Send document checklist to client").
 *
 * Tasks are a first-class collection rather than an array on the order because
 * the workflow board queries them across orders and across assignees — an
 * embedded array would require scanning every order document to answer
 * "what is overdue for Operations".
 */
export interface WorkflowTaskAttrs {
  orderId: Types.ObjectId;
  stage: string;
  title: string;
  assigneeId: Types.ObjectId | null;
  dueDate: Date | null;
  status: TaskStatus;
  priority: TaskPriority;

  createdAt: Date;
  updatedAt: Date;
}

const workflowTaskSchema = new Schema<WorkflowTaskAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    stage: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    dueDate: { type: Date, default: null },
    status: {
      type: String,
      required: true,
      enum: ["Todo", "In Progress", "Done", "Blocked"],
      default: "Todo",
    },
    priority: {
      type: String,
      required: true,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
  },
  { timestamps: true, versionKey: false },
);

// The workflow board's two main views: "my work" and "what is overdue".
workflowTaskSchema.index({ assigneeId: 1, status: 1 });
workflowTaskSchema.index({ orderId: 1, createdAt: -1 });
workflowTaskSchema.index({ dueDate: 1, status: 1 });

export type WorkflowTaskDoc = HydratedDocument<WorkflowTaskAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type WorkflowTaskLean = WorkflowTaskAttrs & { _id: Types.ObjectId };

export const WorkflowTask: Model<WorkflowTaskAttrs> = model<WorkflowTaskAttrs>(
  "WorkflowTask",
  workflowTaskSchema,
);
