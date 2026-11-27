/**
 * PATCH /api/applications/level-2 — Save 5-step AVETMISS, USI & e-signature fields.
 *
 * Can be completed by the Candidate (/applicant), BDC (/sales), or External
 * Broker (/partner) (docs v5.1 §2 Module 3 Step B).
 *
 * Steps:
 *   1 — Course & Delivery
 *   2 — Personal & USI Verification
 *   3 — AVETMISS Demographics
 *   4 — RPL Checklist & Live 100-Point ID Vault
 *   5 — Policies & Digital E-Signature
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const PATCH = withAuth(async (req) => {
  const actor = (req as AuthedRequest).auth!;
  const roleNames = actor.roleNames ?? [];

  const isCandidate = roleNames.includes("CANDIDATE") || actor.role === "CANDIDATE";
  const isBDC = roleNames.includes("BDC") || roleNames.includes("SALES_BDC") || actor.role === "BDC" || actor.role === "SALES_BDC";
  const isBroker = roleNames.includes("B2B_AGENT") || roleNames.includes("EXTERNAL_BROKER") || actor.role === "B2B_AGENT" || actor.role === "EXTERNAL_BROKER";
  const isOps = roleNames.includes("OPS_ADMIN") || roleNames.includes("ACCOUNTS") || actor.role === "OPS_ADMIN" || actor.role === "ACCOUNTS";
  const isAdmin = roleNames.includes("SUPER_ADMIN") || roleNames.includes("ADMIN");

  if (!isCandidate && !isBDC && !isBroker && !isOps && !isAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Not authorized to complete Level 2." } },
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

  const { clientId, orderId, step, level2Completed, ...stepData } = body;

  if (!clientId && !orderId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "clientId or orderId is required." } },
      { status: 400 },
    );
  }

  const now = new Date();
  const orders = await collection("orders");

  // Resolve the order.
  let targetOrderId: string;
  if (orderId) {
    const oid = safeObjectId(orderId);
    if (!oid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid order id format." } },
        { status: 400 },
      );
    }
    const order = await orders.findOne({ _id: oid });
    if (!order) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Order not found." } },
        { status: 404 },
      );
    }
    // Ownership check for non-admins.
    if (!isAdmin && !isOps) {
      const canAccess =
        (isBDC && String(order.bdc_id) === actor.userId) ||
        (isBroker && String(order.b2b_agent_id) === actor.userId) ||
        (isCandidate && String(order.clientId) === clientId);
      if (!canAccess) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Not authorized to access this application." } },
          { status: 403 },
        );
      }
    }
    targetOrderId = orderId;
  } else {
    // Find the most recent DRAFT order for this client.
    const clientOid = safeObjectId(clientId);
    if (!clientOid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid client id format." } },
        { status: 400 },
      );
    }
    const order = await orders.findOne(
      { clientId: clientOid, status: "DRAFT" },
      { sort: { createdAt: -1 } },
    );
    if (!order) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "No DRAFT application found for this client." } },
        { status: 404 },
      );
    }
    targetOrderId = String(order._id);
  }

  // Build the update document with step data.
  const update: Record<string, unknown> = {
    updatedAt: now,
  };

  if (step === 1) {
    update.enrolmentType = stepData.enrolmentType;
    update.deliveryMode = stepData.deliveryMode;
    update.creditTransfer = stepData.creditTransfer;
    update.intakeDate = stepData.intakeDate;
  } else if (step === 2) {
    update.usiNumber = stepData.usiNumber;
    update.usiVerified = stepData.usiVerified ?? false;
    update.legalName = stepData.legalName;
    update.dob = stepData.dob;
    update.residentialAddress = stepData.residentialAddress;
    update.postalAddress = stepData.postalAddress;
    update.emergencyContactName = stepData.emergencyContactName;
    update.emergencyContactPhone = stepData.emergencyContactPhone;
    update.usiApplicationAuthority = stepData.usiApplicationAuthority ?? null;
  } else if (step === 3) {
    update.avetmissProfile = {
      citizenship: stepData.citizenship,
      countryOfBirth: stepData.countryOfBirth,
      languageAtHome: stepData.languageAtHome,
      englishProficiency: stepData.englishProficiency,
      indigenousStatus: stepData.indigenousStatus,
      disabilityFlags: stepData.disabilityFlags,
      highestSchoolLevel: stepData.highestSchoolLevel,
      priorQualifications: stepData.priorQualifications,
      employmentStatus: stepData.employmentStatus,
      studyReason: stepData.studyReason,
    };
  } else if (step === 4) {
    update.rplEvidence = {
      academicCertificates: stepData.academicCertificates ?? false,
      resume: stepData.resume ?? false,
      refereeLetters: stepData.refereeLetters ?? false,
      workSamples: stepData.workSamples ?? false,
      usiVetTranscript: stepData.usiVetTranscript ?? false,
      visaCopy: stepData.visaCopy ?? false,
    };
  } else if (step === 5) {
    update.policies = {
      medicalIndemnity: stepData.medicalIndemnity ?? false,
      mediaConsent: stepData.mediaConsent ?? false,
      refundPolicy: stepData.refundPolicy ?? false,
      ncverPrivacy: stepData.ncverPrivacy ?? false,
    };
    update.studentSignature = stepData.studentSignature ?? null;
    update.signatureDate = stepData.signatureDate ?? null;
    update.parentGuardianSignature = stepData.parentGuardianSignature ?? null;
  }

  if (level2Completed === true) {
    update.level2Completed = true;
  }

  await orders.updateOne(
    { _id: safeObjectId(targetOrderId)! },
    { $set: update, $push: { history: { timestamp: now, field: `level2_step_${step}`, before: "—", after: "completed", actorId: actor.userId } } as any },
  );

  await writeAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    entityType: "order",
    entityId: targetOrderId,
    action: "level_2_save",
    before: { step },
    after: { step, ...stepData, level2Completed },
  });

  return NextResponse.json({ ok: true, orderId: targetOrderId, step });
});
