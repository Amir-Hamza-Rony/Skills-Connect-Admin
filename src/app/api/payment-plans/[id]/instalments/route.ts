/**
 * POST /api/payment-plans/[id]/instalments — append an instalment (requires finance.manage)
 *
 * Validates the instalment amount and due date, ensures the cumulative
 * scheduled amount stays within the plan total, and preserves existing
 * instalment history. Mirrors Express `POST /payment-plans/:id/instalments`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const instalmentBodySchema = (body: any) => {
  if (!body || typeof body.dueDate !== "string" || !body.dueDate.trim()) {
    throw new Error("dueDate is required.");
  }
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
    throw new Error("amount must be a positive number.");
  }
  return { dueDate: body.dueDate.trim(), amount: Number(body.amount) };
};

export const POST = withAuth("finance.manage",
  async (req: NextRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const planOid = safeObjectId(id);
    if (!planOid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid payment plan id." } },
        { status: 400 },
      );
    }

    const actor = (req as AuthedRequest).auth!;

    let body: { dueDate: string; amount: number };
    try {
      body = instalmentBodySchema(await req.json());
    } catch (err: any) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: err.message ?? "Invalid request body." } },
        { status: 400 },
      );
    }

    const dueDate = new Date(body.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid dueDate." } },
        { status: 400 },
      );
    }

    const plans = await collection("payment-plans");
    const plan = await plans.findOne({ _id: planOid });
    if (!plan) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Payment plan not found." } },
        { status: 404 },
      );
    }

    const existingInstalments: Array<{ amount: number; paidAmount: number }> = plan.instalments ?? [];
    const scheduledTotal = existingInstalments.reduce((s, i) => s + (i.amount ?? 0), 0);
    if (scheduledTotal + body.amount > Number(plan.total ?? 0)) {
      return NextResponse.json(
        {
          error: {
            code: "OVER_SCHEDULED",
            message: "Instalment amount would exceed the plan total.",
          },
        },
        { status: 400 },
      );
    }

    const instalment = {
      dueDate,
      amount: body.amount,
      paidAmount: 0,
      status: "Pending",
      createdAt: new Date(),
    };

    const newScheduled = scheduledTotal + body.amount;
    const planTotal = Number(plan.total ?? 0);
    const paidTotal = existingInstalments.reduce((s, i) => s + (i.paidAmount ?? 0), 0);

    await plans.updateOne(
      { _id: planOid },
      {
        $push: { instalments: instalment },
        $set: { updatedAt: new Date() },
      },
    );

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "payment-plan",
      entityId: String(id),
      action: "instalment_added",
      before: { total: planTotal, scheduledTotal, paidTotal },
      after: { total: planTotal, scheduledTotal: newScheduled, paidTotal },
    });

    return NextResponse.json({
      plan: { id: id, total: planTotal, scheduledTotal: newScheduled, outstanding: Math.max(0, planTotal - paidTotal), instalment },
    }, { status: 201 });
  },
);
