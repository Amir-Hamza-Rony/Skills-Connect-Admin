/**
 * Workflow vocabularies — Spec §5–§6.
 *
 * These are the status words the business actually uses. They are reproduced
 * verbatim from the front-end matrix (`src/lib/types.ts`) so the two never
 * drift, and they are closed unions: an order cannot be moved into a status that
 * does not exist, which is what makes the transition guard in
 * `services/order.service.ts` exhaustive rather than a string comparison.
 *
 * The front-end copy is a display mirror only — the server is what validates a
 * transition.
 */

export const ORDER_STATUSES = [
  "Lead",
  "Qualified",
  "Won",
  "Lost",
  "New",
  "Awaiting Payment",
  "Awaiting Documents",
  "Documents Under Review",
  "Ready for Submission",
  "Submitted to Source Agent",
  "Submitted to RTO",
  "RTO Acknowledged",
  "Under Assessment",
  "Additional Evidence Required",
  "Rework Required",
  "Approved",
  "Certificate Issued",
  "Completed",
  "On Hold",
  "Cancelled",
  "Refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const EVIDENCE_STATUSES = [
  "Not Started",
  "In Progress",
  "Complete",
  "Additional Evidence Required",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const RTO_SUBMISSION_STATUSES = [
  "Not Ready",
  "Ready",
  "Submitted",
  "Acknowledged",
  "Under Assessment",
  "Additional Evidence Required",
  "Issued",
] as const;

export type RtoSubmissionStatus = (typeof RTO_SUBMISSION_STATUSES)[number];

export const CERTIFICATE_STATUSES = [
  "Not Issued",
  "Pending",
  "Issued",
  "Certificate File Received",
  "Delivered to Client",
] as const;

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const TASK_STATUSES = ["Todo", "In Progress", "Done", "Blocked"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const DOCUMENT_STATUSES = [
  "Requested",
  "Not Received",
  "Received",
  "Under Review",
  "Approved",
  "Rejected",
  "Superseded",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const CLIENT_STATUSES = ["Prospect", "Active", "On Hold", "Inactive"] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isClientStatus(value: unknown): value is ClientStatus {
  return typeof value === "string" && (CLIENT_STATUSES as readonly string[]).includes(value);
}
