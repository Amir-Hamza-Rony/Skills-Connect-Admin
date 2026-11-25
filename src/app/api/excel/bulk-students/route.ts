/**
 * POST /api/excel/bulk-students — Bulk import clients, orders, invoices and
 * payments from the Master Student Database Excel file.
 *
 * Expected sheet: "Master Sheet" with headers in row 2.
 *
 * Column mapping (1-based):
 *   1  Sl
 *   2  Enrolled Date
 *   3  Invoice (invoice number)
 *   4  Full Name
 *   5  Payment Status
 *   6  Mobile No.
 *   7  Email
 *   8  Orgin
 *   9  Address
 *   10 State
 *   11 Package
 *   12 Course Info (e.g. "AUR30620 Certificate III in Light Vehicle Mechanical Technology")
 *   13 Lead Source
 *   14 Sale (selling price)
 *   15 Recieved (amount received)
 *   16 Due (amount due)
 *   17-28 Installment 1-6: Amount + Date pairs
 *   29 RTO Agent
 *   30 Inv No.
 *   31 Save amount
 *   32 Payable
 *   33 Paid
 *   34 Due
 *   35 Invoice Paid Date
 *   36 Status
 *   37 File Status (RTO)
 *   38 Payment Status(RTO)
 *   39-44 Soft Copy, SCR Date, Hard Copy, Postage Date, Delivery Address, Comment
 *
 * Creates clients (dedup by email), then orders (matched to qualifications by
 * course code), then invoices and payments from financial data.
 * Skips rows where the qualification cannot be resolved.
 */
import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import * as ExcelJS from "exceljs";

const PERMISSION = "finance.manage";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SHEET_NAME = "Master Sheet";

// Column indices (1-based) for the Master Sheet.
const COL = {
  SL: 1,
  ENROLLED_DATE: 2,
  INVOICE_NO: 3,
  FULL_NAME: 4,
  PAYMENT_STATUS: 5,
  MOBILE: 6,
  EMAIL: 7,
  ORIGIN: 8,
  ADDRESS: 9,
  STATE: 10,
  PACKAGE: 11,
  COURSE_INFO: 12,
  LEAD_SOURCE: 13,
  SALE: 14,
  RECEIVED: 15,
  DUE: 16,
  RTO_AGENT: 29,
  INV_NO: 30,
  PAYABLE: 32,
  PAID: 33,
  DUE_AMOUNT: 34,
  INVOICE_PAID_DATE: 35,
  STATUS: 36,
  FILE_STATUS_RTO: 37,
  PAYMENT_STATUS_RTO: 38,
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

function cellDate(cell: unknown): string | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (cell instanceof Date) return cell.toISOString();
  const d = new Date(String(cell));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function extractCourseCode(courseInfo: string): string | null {
  // Course Info format: "AUR30620 Certificate III in Light Vehicle Mechanical Technology"
  const match = courseInfo.match(/^([A-Z]{2,3}\d{4,5})/);
  return match ? match[1] : null;
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

    // Read headers from row 2.
    const headers: string[] = [];
    const headerRow = ws.getRow(2);
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = cellStr(cell.value);
    });

    // Pre-load reference data for lookups.
    const qualColl = await collection("qualifications");
    const rtoColl = await collection("rtos");
    const agentColl = await collection("agents");
    const clientColl = await collection("clients");
    const orderColl = await collection("orders");
    const invoiceColl = await collection("invoices");
    const paymentColl = await collection("payments");

    const allQuals = await qualColl.find().toArray();
    const allRtos = await rtoColl.find().toArray();
    const allAgents = await agentColl.find().toArray();
    const allClients = await clientColl.find().toArray();

    const qualByCode = new Map<string, any>();
    for (const q of allQuals) qualByCode.set(String(q.code), q);
    const rtoByCode = new Map<string, any>();
    for (const r of allRtos) rtoByCode.set(String(r.rtoCode), r);
    const rtoByName = new Map<string, any>();
    for (const r of allRtos) {
      rtoByName.set(String(r.tradingName).toLowerCase(), r);
      rtoByName.set(String(r.legalName).toLowerCase(), r);
    }
    const agentByName = new Map<string, any>();
    for (const a of allAgents) agentByName.set(String(a.name).toLowerCase(), a);
    const clientByEmail = new Map<string, any>();
    for (const c of allClients) clientByEmail.set(String(c.email).toLowerCase(), c);

    const now = new Date();
    let clientsCreated = 0;
    let ordersCreated = 0;
    let invoicesCreated = 0;
    let paymentsCreated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];

    const client = await (await import("@/lib/db")).getClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        for (let rowNum = 3; rowNum <= ws.rowCount; rowNum++) {
          const row = ws.getRow(rowNum);
          let hasAnyValue = false;
          row.eachCell((cell) => {
            if (cell.value !== null && cell.value !== undefined && cell.value !== "") {
              hasAnyValue = true;
            }
          });
          if (!hasAnyValue) continue;

          const fullName = cellStr(row.getCell(COL.FULL_NAME).value);
          const email = cellStr(row.getCell(COL.EMAIL).value);
          const mobile = cellStr(row.getCell(COL.MOBILE).value);
          const courseInfo = cellStr(row.getCell(COL.COURSE_INFO).value);
          const sale = cellNum(row.getCell(COL.SALE).value);
          const received = cellNum(row.getCell(COL.RECEIVED).value);
          const rtoAgent = cellStr(row.getCell(COL.RTO_AGENT).value);

          if (!fullName || !email) {
            skipped++;
            continue;
          }

          // --- Create or find client ---
          let clientDoc = clientByEmail.get(email.toLowerCase());
          if (!clientDoc) {
            const address = cellStr(row.getCell(COL.ADDRESS).value);
            const state = cellStr(row.getCell(COL.STATE).value);
            const usiNumber = undefined; // Not in this sheet format
            const dob = undefined;
            const visaStatus = undefined;

            const insertResult = await clientColl.insertOne({
              legalName: fullName,
              preferredName: fullName,
              email: email.trim(),
              phone: mobile || undefined,
              dob: null,
              usiNumber: null,
              visaStatus: null,
              contacts: [
                { label: "Mobile", type: "phone", value: mobile, primary: true },
                { label: "Email", type: "email", value: email, primary: true },
              ],
              addresses: address
                ? [{ label: "Home", street: address, city: "", state, postalCode: "", country: "Australia", primary: true }]
                : [],
              status: "Active",
              sourceAgentId: null,
              notes: `Imported from Master Student Database. Origin: ${cellStr(row.getCell(COL.ORIGIN).value)}`,
              createdAt: now,
              updatedAt: now,
            }, { session });
            clientDoc = { ...insertResult, _id: insertResult.insertedId, legalName: fullName, email: email.trim() };
            clientByEmail.set(email.toLowerCase(), clientDoc);
            clientsCreated++;
          }

          // --- Resolve qualification ---
          const courseCode = extractCourseCode(courseInfo);
          let qualDoc = null;
          if (courseCode) {
            qualDoc = qualByCode.get(courseCode);
          }
          if (!qualDoc && courseInfo) {
            // Try matching by title substring
            for (const q of allQuals) {
              if (String(q.title).toLowerCase().includes(courseInfo.toLowerCase().slice(0, 30))) {
                qualDoc = q;
                break;
              }
            }
          }

          if (!qualDoc) {
            errors.push({ row: rowNum, message: `Qualification not found for: ${courseInfo || courseCode || "unknown"}` });
            skipped++;
            continue;
          }

          // --- Resolve RTO ---
          let rtoDoc = null;
          if (rtoAgent) {
            rtoDoc = rtoByCode.get(rtoAgent) || rtoByName.get(rtoAgent.toLowerCase());
          }

          // --- Resolve source agent ---
          let sourceAgentDoc = null;
          // Use lead source or RTO agent as source agent
          const leadSource = cellStr(row.getCell(COL.LEAD_SOURCE).value);
          const agentName = leadSource || rtoAgent;
          if (agentName) {
            sourceAgentDoc = agentByName.get(agentName.toLowerCase());
          }

          if (!sourceAgentDoc) {
            // Use any active certificate_source agent as fallback
            const fallback = allAgents.find((a: any) => a.type === "certificate_source" && a.active);
            if (fallback) sourceAgentDoc = fallback;
          }

          if (!sourceAgentDoc) {
            errors.push({ row: rowNum, message: "No source agent available" });
            skipped++;
            continue;
          }

          // --- Create order ---
          const sellingPrice = sale ?? 0;
          const enrolledDate = cellDate(row.getCell(COL.ENROLLED_DATE).value) || now.toISOString();

          const orderResult = await orderColl.insertOne({
            clientId: clientDoc._id,
            qualificationId: qualDoc._id,
            salesAgentId: sourceAgentDoc._id,
            sourceAgentId: sourceAgentDoc._id,
            rtoId: rtoDoc ? rtoDoc._id : null,
            status: "New",
            evidenceStatus: "Not Started",
            rtoSubmissionStatus: "Not Ready",
            certificateStatus: "Not Issued",
            sellingPrice,
            supplierCostSnapshot: 0,
            otherCost: 0,
            currency: "AUD",
            priceCategoryId: null,
            priceListId: null,
            supplierRouteId: null,
            rtoContactId: null,
            rtoContactName: null,
            rplPartnerId: null,
            additionalFees: [],
            feeTotal: 0,
            completedAt: null,
            history: [{ timestamp: now, field: "status", before: "—", after: "New" }],
            createdAt: new Date(enrolledDate),
            updatedAt: now,
            bdc_id: null,
            b2b_agent_id: null,
            enrollmentCode: null,
            channel_type: null,
          }, { session });
          ordersCreated++;

          const orderId = orderResult.insertedId;

          // --- Create invoice ---
          const invoiceTotal = sellingPrice;
          const invoiceResult = await invoiceColl.insertOne({
            orderId: orderId,
            invoiceNumber: cellStr(row.getCell(COL.INVOICE_NO).value) || `INV-${orderId.toString().slice(-8)}`,
            total: invoiceTotal,
            currency: "AUD",
            issueDate: new Date(enrolledDate).toISOString(),
            dueDate: new Date(enrolledDate).toISOString(),
            status: received && received > 0 ? "Part Paid" : "Draft",
            lineItems: [{ id: "line-1", description: courseInfo || "Course fee", amount: sellingPrice, currency: "AUD", quantity: 1, taxAmount: 0, taxRate: 0 }],
            history: [{ timestamp: now, field: "status", before: "—", after: "Draft", actorId: actor.userId }],
            qbReference: null,
            qbSyncStatus: "Not Synced",
            external: null,
            createdAt: now,
            updatedAt: now,
          }, { session });
          invoicesCreated++;

          const invoiceId = invoiceResult.insertedId;

          // --- Create payment from received amount ---
          const receivedAmount = received ?? 0;
          if (receivedAmount && receivedAmount > 0) {
            const payDate = cellDate(row.getCell(COL.ENROLLED_DATE).value) || now.toISOString();
            await paymentColl.insertOne({
              orderId: orderId,
              invoiceId: invoiceId,
              amount: receivedAmount,
              currency: "AUD",
              date: new Date(payDate),
              method: "Bank Transfer",
              reference: cellStr(row.getCell(COL.INV_NO).value) || `IMP-${rowNum}`,
              allocatedAmount: Math.min(receivedAmount, invoiceTotal),
              status: "Allocated",
              verificationStatus: "Verified",
              createdAt: now,
              updatedAt: now,
            }, { session });
            paymentsCreated++;
          }
        }
      });
    } catch (err: any) {
      await session.endSession().catch(() => {});
      return NextResponse.json(
        { error: { code: "SERVER_ERROR", message: err?.message ?? "Bulk import failed." } },
        { status: 500 },
      );
    } finally {
      await session.endSession().catch(() => {});
    }

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_bulk_students",
      entityId: null,
      action: "import",
      before: null,
      after: {
        filename: file.name,
        sheet: SHEET_NAME,
        clientsCreated,
        ordersCreated,
        invoicesCreated,
        paymentsCreated,
        skipped,
        errors: errors.length,
      },
    });

    return NextResponse.json({
      clientsCreated,
      ordersCreated,
      invoicesCreated,
      paymentsCreated,
      skipped,
      errors,
    }, { status: 201 });
  },
);
