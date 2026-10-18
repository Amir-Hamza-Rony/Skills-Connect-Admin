import { Router } from "express";
import { z } from "zod";

import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import {
  accessLog,
  confirmUpload,
  requestDownloadUrl,
  requestUploadUrl,
  reviewDocument,
} from "../services/document.service.js";
import { auditContextFrom } from "../services/audit.service.js";

export const documentsRouter: Router = Router();

documentsRouter.use(requireAuth);

const uploadBody = z.object({
  orderId: z.string().min(1),
  type: z.string().trim().min(1).max(120),
  contentType: z.string().trim().min(1).max(200),
});

/**
 * `POST /documents/upload-url`
 *
 * Returns a presigned PUT URL and the new document row. The client uploads the
 * file bytes straight to storage; the API never sees them.
 *
 * Needs `documents.view` rather than `documents.review` because uploading is
 * part of collecting documents, not judging them — a sales agent gathering
 * evidence should be able to upload without also being able to approve.
 */
documentsRouter.post(
  "/upload-url",
  requirePermission("documents.view"),
  async (req, res) => {
    const body = uploadBody.parse(req.body);
    const result = await requestUploadUrl(body.orderId, body.type, body.contentType, {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.status(201).json(result);
  },
);

/** `POST /documents/:id/confirm-upload` — verify the file landed, mark received. */
documentsRouter.post(
  "/:id/confirm-upload",
  requirePermission("documents.view"),
  async (req, res) => {
    const document = await confirmUpload(param(req, "id"), {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.json({ document });
  },
);

/**
 * `GET /documents/:id/download-url`
 *
 * Returns a presigned GET URL and records the access. The raw storage key is
 * never in the response.
 */
documentsRouter.get(
  "/:id/download-url",
  requirePermission("documents.view"),
  async (req, res) => {
    const result = await requestDownloadUrl(param(req, "id"), {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.json(result);
  },
);

const reviewBody = z.object({
  verdict: z.enum(["Approved", "Rejected"]),
  reason: z.string().trim().max(1000).optional(),
});

/** `PATCH /documents/:id/review` — approve or reject. Needs `documents.review`. */
documentsRouter.patch(
  "/:id/review",
  requirePermission("documents.review"),
  async (req, res) => {
    const body = reviewBody.parse(req.body);
    const document = await reviewDocument(
      param(req, "id"),
      body.verdict,
      req.auth!.userId,
      body.reason,
      { ...auditContextFrom(req), id: req.auth!.userId, email: req.auth!.email },
    );
    res.json({ document });
  },
);

/** `GET /documents/:id/access-log` — who looked at this document. */
documentsRouter.get(
  "/:id/access-log",
  requirePermission("documents.review"),
  async (req, res) => {
    res.json({ events: await accessLog(param(req, "id")) });
  },
);
