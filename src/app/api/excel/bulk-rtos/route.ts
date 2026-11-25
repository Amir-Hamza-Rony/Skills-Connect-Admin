/**
 * POST /api/excel/bulk-rtos — Bulk import RTOs, qualifications, and
 * qualification↔RTO mappings from the "RTO Directory" sheet of the
 * RTO & Onboarding Master Hub Excel file.
 *
 * Expected sheet: "RTO Directory" with column headers in row 7.
 *
 * Column mapping (1-based):
 *   2  RTO Name
 *   3  RTO Code
 *   4  CRICOS Provider Code
 *   5  Qualification Code
 *   6  Qualification Title
 *   7  RTO Wholesale Fee
 *   8  Compliance Risk
 *   9  Course Status
 *   10 Registration Status
 *   11 RTO Agent Contact
 *   12 RTO Contact Details
 *   13 Enrolment Link
 *   14 Regulatory Authority / Notes
 *   15 Licensing / Regulatory Notes
 *
 * Section header rows (starting with "📦" or "Training Package") are skipped.
 * RTOs are deduplicated by RTO code. Qualifications are deduplicated by code.
 * Supplier routes and qualification↔RTO mappings are created per row.
 */
import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import * as ExcelJS from "exceljs";

const PERMISSION = "rto.manage";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SHEET_NAME = "RTO Directory";

// Column indices (1-based) for the RTO Directory sheet (headers in row 7).
const COL = {
  RTO_NAME: 2,
  RTO_CODE: 3,
  CRICOS_CODE: 4,
  QUAL_CODE: 5,
  QUAL_TITLE: 6,
  WHOLESALE_FEE: 7,
  COMPLIANCE_RISK: 8,
  COURSE_STATUS: 9,
  REGISTRATION_STATUS: 10,
  RTO_AGENT_CONTACT: 11,
  RTO_CONTACT_DETAILS: 12,
  ENROLMENT_LINK: 13,
  REGULATORY_NOTES: 14,
  LICENSING_NOTES: 15,
} as const;

function cellStr(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") return String(cell);
  return String(cell);
}

function cellNum(cell: unknown): number | null {
  if (cell === null || cell === undefined || cell === "") return null;
  const n = typeof cell === "number" ? cell : Number(cell);
  return Number.isFinite(n) ? n : null;
}

function isSectionHeader(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.startsWith("📦")) return true;
  if (v.toLowerCase().includes("training package")) return true;
  if (v.toLowerCase().includes("partner rtos")) return true;
  return false;
}

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
    if (
      !auth?.roleNames?.includes("SUPER_ADMIN") &&
      !auth?.permissions?.includes(PERMISSION)
    ) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } },
        { status: 403 },
      );
    }

    const actor = (req as AuthedRequest).auth!;
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "No file uploaded." } },
        { status: 400 },
      );
    }

    const ext = file.name.lastIndexOf(".") === -1 ? "" : file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (![".xlsx", ".xls"].includes(ext)) {
      return NextResponse.json(
        { error: { code: "UNSUPPORTED_TYPE", message: "Only .xlsx and .xls files are supported." } },
        { status: 422 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: { code: "FILE_TOO_LARGE", message: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit.` } },
        { status: 422 },
      );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const ws = workbook.getWorksheet(SHEET_NAME);
    if (!ws) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: `Sheet "${SHEET_NAME}" not found in workbook.` } },
        { status: 404 },
      );
    }

    // Pre-load existing reference data for dedup and lookups.
    const rtoColl = await collection("rtos");
    const qualColl = await collection("qualifications");
    const agentColl = await collection("agents");
    const routeColl = await collection("supplier-routes");
    const mappingColl = await collection("qualification-rto-mappings");

    const allRtos = await rtoColl.find().toArray();
    const allQuals = await qualColl.find().toArray();
    const allAgents = await agentColl.find().toArray();
    const allRoutes = await routeColl.find().toArray();
    const allMappings = await mappingColl.find().toArray();

    const rtoByCode = new Map<string, any>();
    for (const r of allRtos) rtoByCode.set(String(r.rtoCode), r);
    const qualByCode = new Map<string, any>();
    for (const q of allQuals) qualByCode.set(String(q.code), q);
    const agentByName = new Map<string, any>();
    for (const a of allAgents) agentByName.set(String(a.name).toLowerCase(), a);

    // Index existing routes by qualificationId|rtoId to avoid duplicates.
    const existingRouteKeys = new Set<string>();
    for (const r of allRoutes) {
      existingRouteKeys.add(`${String(r.qualificationId)}|${String(r.rtoId)}`);
    }
    // Index existing mappings by qualificationId|rtoId.
    const existingMappingKeys = new Set<string>();
    for (const m of allMappings) {
      existingMappingKeys.add(`${String(m.qualificationId)}|${String(m.rtoId)}`);
    }

    const now = new Date();
    let rtosCreated = 0;
    let qualificationsCreated = 0;
    let routesCreated = 0;
    let mappingsCreated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];

    const client = await (await import("@/lib/db")).getClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        // Headers are in row 7. Data starts from row 8.
        for (let rowNum = 8; rowNum <= ws.rowCount; rowNum++) {
          const row = ws.getRow(rowNum);
          let hasAnyValue = false;
          row.eachCell((cell) => {
            if (cell.value !== null && cell.value !== undefined && cell.value !== "") {
              hasAnyValue = true;
            }
          });
          if (!hasAnyValue) continue;

          const rtoName = cellStr(row.getCell(COL.RTO_NAME).value);
          const rtoCode = cellStr(row.getCell(COL.RTO_CODE).value);
          const qualCode = cellStr(row.getCell(COL.QUAL_CODE).value);
          const qualTitle = cellStr(row.getCell(COL.QUAL_TITLE).value);

          // Skip section header rows.
          if (isSectionHeader(rtoName)) {
            continue;
          }

          if (!rtoName || !rtoCode) {
            skipped++;
            continue;
          }

          // --- Create or find RTO ---
          let rtoDoc = rtoByCode.get(rtoCode.toUpperCase());
          if (!rtoDoc) {
            const cricos = cellStr(row.getCell(COL.CRICOS_CODE).value) || null;
            const agentContact = cellStr(row.getCell(COL.RTO_AGENT_CONTACT).value);
            const contactDetails = cellStr(row.getCell(COL.RTO_CONTACT_DETAILS).value);
            const enrolmentLink = cellStr(row.getCell(COL.ENROLMENT_LINK).value);
            const regulatoryNotes = cellStr(row.getCell(COL.REGULATORY_NOTES).value);
            const licensingNotes = cellStr(row.getCell(COL.LICENSING_NOTES).value);

            const contacts = [];
            if (agentContact) contacts.push({ name: "RTO Agent", role: "agent", email: "", phone: agentContact });
            if (contactDetails) contacts.push({ name: "RTO Contact", role: "contact", email: "", phone: contactDetails });

            const insertResult = await rtoColl.insertOne({
              legalName: rtoName.trim(),
              tradingName: rtoName.trim(),
              rtoCode: rtoCode.trim().toUpperCase(),
              cricosCode: cricos,
              contacts: contacts.length > 0 ? contacts : [],
              status: "active",
              complianceNote: regulatoryNotes || null,
              website: enrolmentLink || null,
              accreditationNumber: null,
              accreditationBody: null,
              accreditationExpiry: null,
              lastAuditDate: null,
              accreditationStatus: null,
              supportingDocumentIds: [],
              accreditationNotes: licensingNotes || null,
              createdAt: now,
              updatedAt: now,
            }, { session });
            rtoDoc = {
              ...insertResult,
              _id: insertResult.insertedId,
              legalName: rtoName.trim(),
              rtoCode: rtoCode.trim().toUpperCase(),
              cricosCode: cricos,
              contacts,
              complianceNote: regulatoryNotes || null,
              website: enrolmentLink || null,
              accreditationNotes: licensingNotes || null,
            };
            rtoByCode.set(rtoCode.toUpperCase(), rtoDoc);
            rtosCreated++;
          }

          // --- Create qualification if provided ---
          let qualDoc = null;
          if (qualCode) {
            qualDoc = qualByCode.get(qualCode.toUpperCase());
            if (!qualDoc) {
              const qResult = await qualColl.insertOne({
                code: qualCode.trim().toUpperCase(),
                title: qualTitle.trim() || "Unknown Qualification",
                trainingPackage: "",
                industry: "",
                status: "current",
                licensingRefs: [],
                createdAt: now,
                updatedAt: now,
              }, { session });
              qualDoc = {
                ...qResult,
                _id: qResult.insertedId,
                code: qualCode.trim().toUpperCase(),
                title: qualTitle.trim() || "Unknown Qualification",
                trainingPackage: "",
                industry: "",
                status: "current",
                licensingRefs: [],
              };
              qualByCode.set(qualCode.toUpperCase(), qualDoc);
              qualificationsCreated++;
            }
          }

          // --- Create qualification↔RTO mapping ---
          if (qualDoc && rtoDoc) {
            const mapKey = `${String(qualDoc._id)}|${String(rtoDoc._id)}`;
            if (!existingMappingKeys.has(mapKey)) {
              const courseStatus = cellStr(row.getCell(COL.COURSE_STATUS).value);
              const regStatus = cellStr(row.getCell(COL.REGISTRATION_STATUS).value);
              await mappingColl.insertOne({
                qualificationId: qualDoc._id,
                rtoId: rtoDoc._id,
                status: courseStatus ? (courseStatus.toLowerCase().includes("active") ? "active" : "inactive") : "active",
                effectiveFrom: now.toISOString(),
                effectiveTo: null,
                createdAt: now,
                updatedAt: now,
              }, { session });
              existingMappingKeys.add(mapKey);
              mappingsCreated++;
            }
          }

          // --- Create supplier route (wholesale cost) ---
          const wholesaleFee = cellNum(row.getCell(COL.WHOLESALE_FEE).value);
          if (wholesaleFee !== null && wholesaleFee >= 0 && qualDoc && rtoDoc) {
            const routeKey = `${String(qualDoc._id)}|${String(rtoDoc._id)}`;
            if (!existingRouteKeys.has(routeKey)) {
              // Find a certificate_source agent as the source agent
              let sourceAgent = allAgents.find((a: any) => a.type === "certificate_source" && a.active);
              const agentName = cellStr(row.getCell(COL.RTO_AGENT_CONTACT).value);
              if (agentName) {
                const matched = agentByName.get(agentName.toLowerCase());
                if (matched && matched.type === "certificate_source" && matched.active) {
                  sourceAgent = matched;
                }
              }

              if (sourceAgent) {
                await routeColl.insertOne({
                  qualificationId: qualDoc._id,
                  sourceAgentId: sourceAgent._id,
                  rtoId: rtoDoc._id,
                  wholesaleCost: wholesaleFee,
                  currency: "AUD",
                  effectiveFrom: now.toISOString(),
                  effectiveTo: null,
                  status: "active",
                  createdAt: now,
                  updatedAt: now,
                }, { session });
                existingRouteKeys.add(routeKey);
                routesCreated++;
              }
            }
          }
        }
      });
    } catch (err: any) {
      await session.endSession().catch(() => {});
      return NextResponse.json(
        { error: { code: "SERVER_ERROR", message: err?.message ?? "Bulk RTO import failed." } },
        { status: 500 },
      );
    } finally {
      await session.endSession().catch(() => {});
    }

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_bulk_rtos",
      entityId: null,
      action: "import",
      before: null,
      after: {
        filename: file.name,
        sheet: SHEET_NAME,
        rtosCreated,
        qualificationsCreated,
        routesCreated,
        mappingsCreated,
        skipped,
        errors: errors.length,
      },
    });

    return NextResponse.json({
      rtosCreated,
      qualificationsCreated,
      routesCreated,
      mappingsCreated,
      skipped,
      errors,
    }, { status: 201 });
  },
);
