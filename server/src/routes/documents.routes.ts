import { Router } from "express";
import { z } from "zod";
import multer from "multer";

import { AppError } from "../lib/app-error.js";
import { param } from "../lib/params.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import {
  accessLog,
  getDocumentData,
  reviewDocument,
  uploadDocument,
} from "../services/document.service.js";
import { auditContextFrom } from "../services/audit.service.js";

/** Memory storage — file bytes stay in RAM and are written straight to MongoDB. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB hard ceiling
});

export const documentsRouter: Router = Router();

documentsRouter.use(requireAuth);

/**
 * `POST /documents/upload`
 *
 * Accepts `multipart/form-data` with fields: `file`, `orderId`, `type`.
 * Stores the file bytes directly in MongoDB — no object storage, no S3,
 * no presigned URLs.
 */
documentsRouter.post(
  "/upload",
  requirePermission("documents.view"),
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    const orderId = req.body.orderId;
    const type = req.body.type;

    if (!file) {
      throw AppError.badRequest("NO_FILE", "No file was uploaded. Use the `file` form field.");
    }
    if (!orderId || typeof orderId !== "string") {
      throw AppError.badRequest("INVALID_ORDER_ID", "orderId is required.");
    }
    if (!type || typeof type !== "string") {
      throw AppError.badRequest("INVALID_TYPE", "type is required.");
    }

    const result = await uploadDocument(orderId, file, type, {
      ...auditContextFrom(req),
      id: req.auth!.userId,
      email: req.auth!.email,
    });
    res.status(201).json(result);
  },
);

/**
 * `GET /documents/:id/download`
 *
 * Streams the stored file bytes from MongoDB with the document's content type.
 * The raw binary never reaches the browser as JSON — it is served as an
 * octet-stream download with the original filename.
 */
documentsRouter.get(
  "/:id/download",
  requirePermission("documents.view"),
  async (req, res) => {
    const { data, fileName, contentType } = await getDocumentData(param(req, "id"));

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", String(data.length));
    res.setHeader("X-Request-Id", req.headers["x-request-id"] ?? "");
    res.send(data);
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
