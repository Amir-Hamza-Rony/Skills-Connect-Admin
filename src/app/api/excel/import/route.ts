/**
 * POST /api/excel/import — Execute a validated import from a previewed upload.
 *
 * Reads a template (scope + column mappings), validates each row against the
 * mapping rules and scope-specific business rules, persists only valid records
 * to the target collection, and records import job + per-row results.
 * Returns accurate rowCounts — never synthetic success.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId, getClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { ImportScope, ImportColumnMapping } from "@/lib/types";

const VALID_SCOPES: Set<ImportScope> = new Set(["clients", "orders", "rtos", "agents", "qualifications"]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function coerceValue(value: unknown, dataType: string): { ok: boolean; value: unknown; error?: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  switch (dataType) {
    case "string":
      return { ok: true, value: String(value) };
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, value: null, error: "not a valid number" };
      return { ok: true, value: n };
    }
    case "date": {
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return { ok: false, value: null, error: "not a valid date" };
      return { ok: true, value: d };
    }
    case "boolean":
      return { ok: true, value: value === true || value === "true" || value === 1 };
    case "email": {
      const s = String(value);
      if (!EMAIL_REGEX.test(s)) return { ok: false, value: null, error: "not a valid email" };
      return { ok: true, value: s };
    }
    default:
      return { ok: true, value: String(value) };
  }
}

function mapRowToDocument(
  row: Record<string, unknown>,
  mappings: ImportColumnMapping[],
): { doc: Record<string, unknown>; errors: string[] } {
  const doc: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const mapping of mappings) {
    const raw = row[mapping.sourceColumn];

    // Required check.
    if (mapping.required && (raw === null || raw === undefined || raw === "")) {
      errors.push(`Missing required field: ${mapping.sourceColumn}`);
      continue;
    }

    // Type coercion + validation.
    if (raw !== null && raw !== undefined && raw !== "") {
      const coerced = coerceValue(raw, mapping.dataType);
      if (!coerced.ok) {
        errors.push(`Invalid ${mapping.dataType} for ${mapping.sourceColumn}: ${coerced.error}`);
        continue;
      }
      doc[mapping.targetField] = coerced.value;
    }
  }

  return { doc, errors };
}

/** Scope-specific duplicate/reference checks before insert. */
async function validateScope(
  scope: ImportScope,
  doc: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  switch (scope) {
    case "qualifications": {
      const code = doc.code;
      if (typeof code === "string" && code) {
        const coll = await collection("qualifications");
        const existing = await coll.findOne({ code: String(code).toUpperCase() });
        if (existing) {
          return { ok: false, error: `Duplicate qualification code: ${code}` };
        }
      }
      return { ok: true };
    }
    case "rtos": {
      const code = doc.rtoCode;
      if (typeof code === "string" && code) {
        const coll = await collection("rtos");
        const existing = await coll.findOne({ rtoCode: String(code).toUpperCase() });
        if (existing) {
          return { ok: false, error: `Duplicate RTO code: ${code}` };
        }
      }
      return { ok: true };
    }
    case "agents": {
      const name = doc.name;
      const contact = doc.contact;
      if (typeof name === "string" && name) {
        const coll = await collection("agents");
        const query: Record<string, unknown> = { name: String(name).trim() };
        if (typeof contact === "string" && contact) {
          query.$or = [{ name: String(name).trim() }, { contact: String(contact).trim() }];
        }
        const existing = await coll.findOne(query);
        if (existing) {
          return { ok: false, error: `Duplicate agent: ${name}` };
        }
      }
      return { ok: true };
    }
    case "clients": {
      const name = doc.name;
      const email = doc.email;
      if (typeof name === "string" && name) {
        const coll = await collection("clients");
        const query: Record<string, unknown> = { name: String(name).trim() };
        if (typeof email === "string" && email) {
          query.$or = [{ name: String(name).trim() }, { email: String(email).trim() }];
        }
        const existing = await coll.findOne(query);
        if (existing) {
          return { ok: false, error: `Duplicate client: ${name}` };
        }
      }
      return { ok: true };
    }
    case "orders": {
      const clientId = doc.clientId;
      const qualificationId = doc.qualificationId;
      if (clientId) {
        const clientOid = safeObjectId(String(clientId));
        if (!clientOid) return { ok: false, error: `Invalid clientId: ${clientId}` };
        const clients = await collection("clients");
        const client = await clients.findOne({ _id: clientOid });
        if (!client) return { ok: false, error: `Referenced client not found: ${clientId}` };
      }
      if (qualificationId) {
        const qOid = safeObjectId(String(qualificationId));
        if (!qOid) return { ok: false, error: `Invalid qualificationId: ${qualificationId}` };
        const quals = await collection("qualifications");
        const qual = await quals.findOne({ _id: qOid });
        if (!qual) return { ok: false, error: `Referenced qualification not found: ${qualificationId}` };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

export const POST = withAuth("finance.manage",
  async (req: AuthedRequest) => {
    const actor = (req as AuthedRequest).auth!;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const { templateId, rows, filename } = body;

    if (!templateId || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "templateId and non-empty rows are required." } },
        { status: 400 },
      );
    }

    const templateOid = safeObjectId(templateId);
    if (!templateOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid template id." } }, { status: 400 });
    }

    const templateColl = await collection("excel_import_templates");
    const template = await templateColl.findOne({ _id: templateOid });
    if (!template) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
    }

    if (template.status !== "active") {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Template is not active." } },
        { status: 400 },
      );
    }

    const scope = template.scope as ImportScope;
    if (!VALID_SCOPES.has(scope)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: `Invalid template scope: ${scope}` } },
        { status: 400 },
      );
    }

    const mappings: ImportColumnMapping[] = Array.isArray(template.columnMappings)
      ? template.columnMappings
      : [];

    // Create import job record.
    const now = new Date();
    const importsColl = await collection("excel_imports");
    const importResult = await importsColl.insertOne({
      templateId: templateOid,
      filename: filename ?? null,
      status: "processing",
      rowCounts: { total: rows.length, success: 0, failed: 0, skipped: 0 },
      startedBy: actor.userId,
      startedAt: now,
      completedAt: null,
      errorSummary: null,
    });
    const importId = importResult.insertedId;

    const rowsColl = await collection("excel_import_rows");
    const targetColl = await collection(scope);

    let success = 0;
    let failed = 0;
    let skipped = 0;

    // Use a session for transaction safety where supported.
    const client = await getClient();
    let session: any = null;
    try {
      session = client.startSession();
      await session.withTransaction(async () => {
        for (let i = 0; i < rows.length; i++) {
          const rawRow = rows[i];
          // Frontend sends { rowNumber, sourceData }; normalize to the row data.
          const rowNumber = rawRow.rowNumber ?? i + 1;
          const row = rawRow.sourceData ?? rawRow;

          // Map + validate row.
          const { doc, errors } = mapRowToDocument(row, mappings);
          if (errors.length > 0) {
            await rowsColl.insertOne({
              importId,
              rowNumber,
              status: "failed",
              errorMessage: errors.join("; "),
              targetRecordId: null,
              rawRow: rawRow,
              createdAt: new Date(),
            }, { session });
            failed++;
            continue;
          }

          // Scope-specific business validation.
          const scopeCheck = await validateScope(scope, doc);
          if (!scopeCheck.ok) {
            await rowsColl.insertOne({
              importId,
              rowNumber,
              status: "failed",
              errorMessage: scopeCheck.error,
              targetRecordId: null,
              rawRow: rawRow,
              createdAt: new Date(),
            }, { session });
            failed++;
            continue;
          }

          // Insert into target collection.
          const insertResult = await targetColl.insertOne({
            ...doc,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: actor.userId,
          }, { session });

          await rowsColl.insertOne({
            importId,
            rowNumber,
            status: "success",
            errorMessage: null,
            targetRecordId: insertResult.insertedId,
            rawRow: rawRow,
            createdAt: new Date(),
          }, { session });
          success++;
        }
      });
    } catch (err: any) {
      // Mark import as failed on transaction error.
      await importsColl.updateOne(
        { _id: importId },
        { $set: { status: "failed", completedAt: new Date(), errorSummary: err?.message ?? "Import failed." } },
      );
      if (session) await session.endSession();
      await writeAudit({
        actorId: actor.userId,
        actorEmail: actor.email,
        entityType: "excel_import",
        entityId: String(importId),
        action: "execute_failed",
        before: null,
        after: { scope, total: rows.length, error: err?.message },
      });
      return NextResponse.json(
        { error: { code: "IMPORT_FAILED", message: err?.message ?? "Import transaction failed." } },
        { status: 500 },
      );
    }
    if (session) await session.endSession();

    skipped = rows.length - success - failed;

    const completedAt = new Date();
    await importsColl.updateOne(
      { _id: importId },
      {
        $set: {
          status: "completed",
          completedAt,
          rowCounts: { total: rows.length, success, failed, skipped },
          errorSummary: failed > 0 ? `${failed} row(s) failed validation` : null,
        },
      },
    );

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_import",
      entityId: String(importId),
      action: "execute",
      before: null,
      after: {
        scope,
        templateId,
        filename,
        rowCounts: { total: rows.length, success, failed, skipped },
      },
    });

    return NextResponse.json({
      import: {
        id: String(importId),
        templateId,
        filename,
        status: "completed",
        rowCounts: { total: rows.length, success, failed, skipped },
      },
    }, { status: 201 });
  },
);
