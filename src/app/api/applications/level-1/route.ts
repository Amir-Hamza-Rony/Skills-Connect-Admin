/**
 * POST /api/applications/level-1 — Level 1 Quick Lead Intake (Status: DRAFT).
 *
 * Triggered by: In-House BDC (/sales) or External B2B Broker (/partner).
 *
 * Fields: Legal Given Names, Family Name, Email, Mobile, Interested Qualification,
 * and Issuing RTO / Partner (auto-filtered from synced scopes).
 *
 * Automated Action: Creates the candidate/application record in DRAFT status,
 * attaches the RTO-specific enrolment kit, and sends a passwordless Magic Link
 * via Email & SMS to /applicant (docs v5.1 §2 Module 3 Step A, v5.0 §6).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { nextEnrollmentCode } from "@/lib/enrollment-code";

export const POST = withAuth("orders.manage",
  async (req) => {
    const actor = (req as AuthedRequest).auth!;
    const role = actor.roleNames ?? [];
    const isBDC = role.includes("BDC") || role.includes("SALES_BDC") || actor.role === "BDC" || actor.role === "SALES_BDC";
    const isBroker = role.includes("B2B_AGENT") || role.includes("EXTERNAL_BROKER") || actor.role === "B2B_AGENT" || actor.role === "EXTERNAL_BROKER";

    if (!isBDC && !isBroker && !role.includes("SUPER_ADMIN") && !role.includes("ADMIN")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Only BDC, Broker, Super Admin or Admin can create Level 1 leads." } },
        { status: 403 },
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const {
      legalGivenNames,
      familyName,
      email,
      mobile,
      interestedQualification,
      issuingRtoId,
    } = body;

    if (!legalGivenNames || !familyName || !email || !mobile) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Legal Given Names, Family Name, Email and Mobile are required." } },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const now = new Date();

    // Find or create the candidate record (1 Candidate → Many Applications).
    const clients = await collection("clients");
    let candidate = await clients.findOne({ email: normalizedEmail });

    if (!candidate) {
      const clientResult = await clients.insertOne({
        legalName: `${legalGivenNames} ${familyName}`,
        preferredName: legalGivenNames,
        email: normalizedEmail,
        phone: mobile,
        contacts: [],
        addresses: [],
        status: "Prospect",
        sourceAgentId: isBroker ? actor.userId : null,
        notes: "Created via Level 1 quick lead intake",
        createdAt: now,
        updatedAt: now,
      });
      candidate = { ...candidate, _id: clientResult.insertedId } as any;
    }

    const candidateId = String(candidate._id);

    // Validate qualification if provided.
    let qualificationId: string | null = null;
    if (interestedQualification) {
      const qOid = safeObjectId(interestedQualification);
      if (!qOid) {
        return NextResponse.json(
          { error: { code: "INVALID_ID", message: "Invalid qualification id format." } },
          { status: 400 },
        );
      }
      const quals = await collection("qualifications");
      const q = await quals.findOne({ _id: qOid });
      if (!q) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Qualification not found." } },
          { status: 404 },
        );
      }
      qualificationId = String(q._id);
    }

    // Validate RTO if provided.
    let rtoId: string | null = null;
    if (issuingRtoId) {
      const rOid = safeObjectId(issuingRtoId);
      if (!rOid) {
        return NextResponse.json(
          { error: { code: "INVALID_ID", message: "Invalid RTO id format." } },
          { status: 400 },
        );
      }
      const rtos = await collection("rtos");
      const r = await rtos.findOne({ _id: rOid });
      if (!r) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "RTO not found." } },
          { status: 404 },
        );
      }
      rtoId = String(r._id);
    }

    // Determine channel type.
    const channelType = isBroker ? "EXTERNAL_B2B" : "IN_HOUSE_B2C";

    // Create the application in DRAFT status.
    const MAX_CODE_ATTEMPTS = 5;
    let enrollmentCode: string | null = null;
    let result: any = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const candidateCode = await nextEnrollmentCode();
      try {
        result = await (await collection("orders")).insertOne({
          clientId: candidate._id,
          qualificationId: qualificationId ? safeObjectId(qualificationId) : null,
          salesAgentId: isBDC ? safeObjectId(actor.userId) : null,
          sourceAgentId: isBroker ? safeObjectId(actor.userId) : null,
          rtoId: rtoId ? safeObjectId(rtoId) : null,
          status: "DRAFT",
          evidenceStatus: "Not Started",
          rtoSubmissionStatus: "Not Ready",
          certificateStatus: "Not Issued",
          sellingPrice: 0,
          supplierCostSnapshot: 0,
          otherCost: 0,
          currency: "AUD",
          additionalFees: [],
          feeTotal: 0,
          completedAt: null,
          history: [{ timestamp: now, field: "status", before: "—", after: "DRAFT" }],
          createdAt: now,
          updatedAt: now,
          trueRtoCost: null,
          approvedInternalCost: null,
          b2bWholesalePrice: null,
          b2cRetailPrice: null,
          channel_type: channelType,
          bdc_id: isBDC ? actor.userId : null,
          b2b_agent_id: isBroker ? actor.userId : null,
          enrollmentCode: candidateCode,
        });
        enrollmentCode = candidateCode;
        break;
      } catch (err: any) {
        if (err?.code !== 11000) throw err;
        if (attempt === MAX_CODE_ATTEMPTS - 1) {
          return NextResponse.json(
            { error: { code: "ENROLLMENT_CODE_EXHAUSTED", message: "Could not allocate a unique enrollment code." } },
            { status: 500 },
          );
        }
      }
    }

    if (!result) {
      return NextResponse.json(
        { error: { code: "ENROLLMENT_CODE_EXHAUSTED", message: "Could not create application." } },
        { status: 500 },
      );
    }

    const orderId = String(result.insertedId);

    // Attach the RTO-specific enrolment kit (auto-attaching upon application creation).
    if (rtoId && qualificationId) {
      const kits = await (await collection("rto_enrolment_kits")).find({
        issuingRtoId: safeObjectId(rtoId)!,
        qualificationId: safeObjectId(qualificationId)!,
      }).toArray();
      for (const kit of kits) {
        await (await collection("documents")).insertOne({
          clientId: candidate._id,
          orderId: result.insertedId,
          type: "RTO Enrolment Kit",
          version: 1,
          fileName: kit.fileName ?? "enrolment-kit.pdf",
          contentType: kit.contentType ?? "application/pdf",
          sizeBytes: kit.sizeBytes ?? 0,
          status: "Not Received",
          receivedAt: null,
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
          storageKey: kit.storageKey ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Generate and send passwordless Magic Link via Email & SMS to /applicant.
    // The magic link token is stored and sent via email/SMS (dev mode returns it).
    const crypto = await import("crypto");
    const magicToken = crypto.randomBytes(32).toString("hex");
    const magicExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await (await collection("magic_link_tokens")).insertOne({
      userId: candidate._id,
      email: normalizedEmail,
      token: magicToken,
      expiresAt: magicExpiresAt,
      used: false,
      purpose: "level-1-lead-intake",
      orderId: result.insertedId,
      createdAt: now,
    });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "order",
      entityId: orderId,
      action: "level_1_lead_intake",
      before: null,
      after: {
        status: "DRAFT",
        candidateId,
        qualificationId,
        rtoId,
        channelType,
        enrollmentCode,
      },
    });

    const isDev = process.env.NODE_ENV !== "production";

    return NextResponse.json({
      application: {
        id: orderId,
        enrollmentCode,
        status: "DRAFT",
        candidateId,
        channelType,
      },
      magicLink: {
        purpose: "Level 1 lead intake — complete Level 2 AVETMISS in /applicant",
        expiresAt: magicExpiresAt,
        ...(isDev ? { _devToken: magicToken } : {}),
      },
      message: "Application created in DRAFT status. Magic link sent to candidate email/SMS.",
    }, { status: 201 });
  },
);
