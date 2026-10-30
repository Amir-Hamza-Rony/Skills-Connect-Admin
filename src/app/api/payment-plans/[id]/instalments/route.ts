/**
 * POST /api/payment-plans/[id]/instalments — append an instalment (requires finance.manage)
 * Mirrors Express `POST /payment-plans/:id/instalments`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

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

    let planId;
    try {
      planId = toObjectId(id);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid payment plan id." } },
        { status: 400 },
      );
    }

    let body: { dueDate: string; amount: number };
    try {
      body = instalmentBodySchema(await req.json());
    } catch (err: any) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: err.message ?? "Invalid request body." } },
        { status: 400 },
      );
    }

    const plans = await collection("payment-plans");
    const plan = await plans.findOne({ _id: planId });
    if (!plan) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Payment plan not found." } },
        { status: 404 },
      );
    }

    const instalment = {
      dueDate: new Date(body.dueDate),
      amount: body.amount,
      status: "Pending",
      createdAt: new Date(),
    };

    await plans.updateOne(
      { _id: planId },
      {
        $push: { instalments: instalment },
        $set: { updatedAt: new Date() },
      },
    );

    return NextResponse.json({ plan: { id: String(planId), instalment } }, { status: 201 });
  },
);
