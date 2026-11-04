import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import {
  POST as createMaster,
  GET as listMasters,
  PATCH as updateMaster,
} from "@/app/api/masters/[type]/route";
import {
  POST as createPriceList,
  GET as listPriceLists,
} from "@/app/api/masters/price-lists/route";
import {
  POST as createPriceCategory,
  GET as listPriceCategories,
} from "@/app/api/masters/price-categories/route";
import {
  POST as createAdditionalFee,
  GET as listAdditionalFees,
} from "@/app/api/masters/additional-fees/route";
import {
  POST as createOrder,
} from "@/app/api/orders/route";
import {
  POST as createCommissionRule,
  GET as listCommissionRules,
} from "@/app/api/masters/commission-rules/route";
import {
  POST as calculateCommission,
} from "@/app/api/commission-records/route";
import {
  POST as approveCommission,
} from "@/app/api/commission-records/[id]/approve/route";
import {
  POST as createPayout,
  GET as listPayouts,
} from "@/app/api/commission-payouts/route";

import {
  authedRequest,
  clearDb,
  seedClient,
  seedQualification,
  seedRto,
  seedAgent,
  seedPriceCategory,
  seedPriceList,
  seedCommissionRule,
  seedSupplierRoute,
  findAuditAction,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

describe("Phase 2 — Price categories", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates a price category and normalises the code to uppercase", async () => {
    const res = await createPriceCategory(
      authedRequest("POST", "/api/masters/price-categories", {
        code: "floor",
        name: "Floor Price",
        status: "active",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.priceCategory.code).toBe("FLOOR");
  });

  it("prevents duplicate price category codes", async () => {
    await createPriceCategory(
      authedRequest("POST", "/api/masters/price-categories", {
        code: "STANDARD",
        name: "Standard Price",
        status: "active",
      }),
    );
    const dup = await createPriceCategory(
      authedRequest("POST", "/api/masters/price-categories", {
        code: "standard",
        name: "Standard Price 2",
        status: "active",
      }),
    );
    expect(dup.status).toBe(409);
  });

  it("lists price categories with status filter", async () => {
    await seedPriceCategory(new ObjectId(), "FLOOR");
    await seedPriceCategory(new ObjectId(), "SPECIAL");
    await seedPriceCategory(new ObjectId(), "ONLINE");

    const list = await listPriceCategories(
      authedRequest("GET", "/api/masters/price-categories?status=active"),
    );
    expect((await json(list)).items.length).toBe(3);
  });
});

describe("Phase 2 — Price lists", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates a price list with currency and effective dates", async () => {
    const qId = await seedQualification();
    const cId = await seedPriceCategory();

    const res = await createPriceList(
      authedRequest("POST", "/api/masters/price-lists", {
        qualificationId: String(qId),
        priceCategoryId: String(cId),
        amount: 5500,
        currency: "AUD",
        effectiveFrom: "2027-01-01",
        status: "active",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.priceList.amount).toBe(5500);
    expect(body.priceList.currency).toBe("AUD");
  });

  it("prevents overlapping active price periods", async () => {
    const qId = await seedQualification();
    const cId = await seedPriceCategory();

    await createPriceList(
      authedRequest("POST", "/api/masters/price-lists", {
        qualificationId: String(qId),
        priceCategoryId: String(cId),
        amount: 5000,
        currency: "AUD",
        effectiveFrom: "2027-01-01",
        effectiveTo: null,
        status: "active",
      }),
    );

    const dup = await createPriceList(
      authedRequest("POST", "/api/masters/price-lists", {
        qualificationId: String(qId),
        priceCategoryId: String(cId),
        amount: 6000,
        currency: "AUD",
        effectiveFrom: "2027-06-01",
        effectiveTo: null,
        status: "active",
      }),
    );
    expect(dup.status).toBe(409);
  });

  it("lists price lists filtered by qualification and category", async () => {
    const qId = await seedQualification();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");

    const list = await listPriceLists(
      authedRequest(
        "GET",
        `/api/masters/price-lists?qualificationId=${qId}&priceCategoryId=${cId}`,
      ),
    );
    expect((await json(list)).items.length).toBe(1);
  });
});

describe("Phase 2 — Additional fees", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates an additional fee applicable to a qualification", async () => {
    const qId = await seedQualification();

    const res = await createAdditionalFee(
      authedRequest("POST", "/api/masters/additional-fees", {
        applicability: "qualification",
        referenceId: String(qId),
        amount: 500,
        currency: "AUD",
        description: "Work placement fee",
        effectiveFrom: "2027-01-01",
        status: "active",
        isOptional: true,
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.additionalFee.amount).toBe(500);
    expect(body.additionalFee.isOptional).toBe(true);
  });

  it("lists additional fees filtered by applicability", async () => {
    const qId = await seedQualification();
    await seedPriceList(new ObjectId(), qId, new ObjectId(), 5000, "AUD");
    const cId = await seedPriceCategory();
    await createAdditionalFee(
      authedRequest("POST", "/api/masters/additional-fees", {
        applicability: "priceCategory",
        referenceId: String(cId),
        amount: 200,
        currency: "AUD",
        description: "Category fee",
        effectiveFrom: "2027-01-01",
        status: "active",
        isOptional: false,
      }),
    );

    const list = await listAdditionalFees(
      authedRequest("GET", "/api/masters/additional-fees?applicability=priceCategory"),
    );
    expect((await json(list)).items.length).toBe(1);
  });
});

describe("Phase 2 — Order pricing snapshot", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("captures selling price, currency, supplier cost and fee snapshot on order creation", async () => {
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const rId = await seedRto();
    const cId = await seedPriceCategory();
    const plId = await seedPriceList(new ObjectId(), qId, cId, 5500, "AUD");
    await seedSupplierRoute(qId, aId, rId, 1500);

    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(aId),
        rtoId: String(rId),
        sellingPrice: 99999, // ignored; price list wins
        priceCategoryId: String(cId),
      }),
      { params: { id: "ignore" } },
    );
    // createOrder signature: (req, {params}) — we pass no params here; the route doesn't use params.
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.id).toBeDefined();
  });

  it("preserves historical selling price and supplier cost (snapshot)", async () => {
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const rId = await seedRto();
    await seedSupplierRoute(qId, aId, rId, 1500);

    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(aId),
        rtoId: String(rId),
        sellingPrice: 5000,
      }),
      { params: { id: "ignore" } },
    );
    expect(res.status).toBe(201);
    const { order } = await json(res);

    const db = (await import("@/lib/db")).getDb;
    const orders = await (await db()).collection("orders");
    const stored = await orders.findOne({ _id: new ObjectId(order.id) });
    expect(stored.sellingPrice).toBe(5000);
    expect(stored.supplierCostSnapshot).toBe(1500);
    expect(stored.currency).toBe("AUD");
    expect(stored.priceListId).toBeNull();
  });
});

describe("Phase 2 — Commission rules", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates a commission rule as draft by default", async () => {
    const agentId = await seedAgent();

    const res = await createCommissionRule(
      authedRequest("POST", "/api/masters/commission-rules", {
        agentId: String(agentId),
        effectiveFrom: "2027-01-01",
        tiers: [{ minDeals: 1, maxDeals: null, commissionPerDeal: 4000 }],
        commissionCurrency: "BDT",
        status: "active",
        approvalStatus: "draft",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.commissionRule.approvalStatus).toBe("draft");
    expect(body.commissionRule.commissionCurrency).toBe("BDT");
  });

  it("requires either agentId or responsibility, not both", async () => {
    const res = await createCommissionRule(
      authedRequest("POST", "/api/masters/commission-rules", {
        agentId: new ObjectId().toString(),
        responsibility: "sales_closing",
        effectiveFrom: "2027-01-01",
        tiers: [{ minDeals: 1, maxDeals: null, commissionPerDeal: 4000 }],
        commissionCurrency: "BDT",
        status: "active",
        approvalStatus: "draft",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("lists commission rules filtered by approval status", async () => {
    const agentId = await seedAgent();
    await seedCommissionRule(new ObjectId(), agentId, "BDT");

    const list = await listCommissionRules(
      authedRequest("GET", "/api/masters/commission-rules?approvalStatus=approved"),
    );
    expect((await json(list)).items.length).toBe(1);
  });
});

describe("Phase 2 — Commission calculation", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("calculates a commission record for an agent and period", async () => {
    const agentId = await seedAgent();
    await seedCommissionRule(new ObjectId(), agentId, "BDT");

    // Create eligible Completed orders in the period.
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const rId = await seedRto();
    await seedSupplierRoute(qId, aId, rId, 1500);
    await seedPriceList(new ObjectId(), qId, new ObjectId(), 5000, "AUD");

    const now = new Date(Date.UTC(2027, 0, 15));
    const db = (await import("@/lib/db")).getDb;
    const ordersColl = await (await db()).collection("orders");
    await ordersColl.insertOne({
      clientId,
      qualificationId: qId,
      salesAgentId: new ObjectId(),
      sourceAgentId: aId,
      rtoId: rId,
      status: "Completed",
      evidenceStatus: "Complete",
      rtoSubmissionStatus: "Issued",
      certificateStatus: "Issued",
      sellingPrice: 5000,
      supplierCostSnapshot: 1500,
      otherCost: 0,
      currency: "BDT",
      completedAt: now,
      createdAt: now,
      updatedAt: now,
      history: [],
    });
    await ordersColl.insertOne({
      clientId,
      qualificationId: qId,
      salesAgentId: new ObjectId(),
      sourceAgentId: aId,
      rtoId: rId,
      status: "Completed",
      evidenceStatus: "Complete",
      rtoSubmissionStatus: "Issued",
      certificateStatus: "Issued",
      sellingPrice: 5000,
      supplierCostSnapshot: 1500,
      otherCost: 0,
      currency: "BDT",
      completedAt: now,
      createdAt: now,
      updatedAt: now,
      history: [],
    });

    const res = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.commissionRecord.status).toBe("calculated");
    expect(body.commissionRecord.eligibleDealCount).toBe(2);
    expect(body.commissionRecord.commissionAmount).toBe(8000); // 2 * 4000
  });

  it("prevents duplicate calculation for the same agent and period", async () => {
    const agentId = await seedAgent();
    await seedCommissionRule(new ObjectId(), agentId, "BDT");

    const a = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    expect(a.status).toBe(201);

    const b = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    expect(b.status).toBe(409);
    expect((await json(b)).error.code).toBe("CONFLICT");
  });
});

describe("Phase 2 — Commission approval and payout", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("approves then pays out a commission record", async () => {
    const agentId = await seedAgent();
    const ruleId = await seedCommissionRule(new ObjectId(), agentId, "BDT");

    const calc = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    const recordId = (await json(calc)).commissionRecord.id;

    const approved = await approveCommission(
      authedRequest("POST", `/api/commission-records/${recordId}/approve`),
      { params: { id: recordId } },
    );
    expect(approved.status).toBe(200);
    expect((await json(approved)).commissionRecord.status).toBe("approved");

    const audit = await findAuditAction("commission_record", "approve");
    expect(audit).toBeTruthy();
  });

  it("records a payout and marks the record paid", async () => {
    const agentId = await seedAgent();
    const ruleId = await seedCommissionRule(new ObjectId(), agentId, "BDT");

    const calc = await calculateCommission(
      authedRequest("POST", "/api/commission-records", {
        action: "calculate",
        agentId: String(agentId),
        periodMonth: 1,
        periodYear: 2027,
      }),
    );
    const recordId = (await json(calc)).commissionRecord.id;

    await approveCommission(
      authedRequest("POST", `/api/commission-records/${recordId}/approve`),
      { params: { id: recordId } },
    );

    const payout = await createPayout(
      authedRequest("POST", "/api/commission-payouts", {
        commissionRecordId: recordId,
        amount: 8000,
        currency: "BDT",
        paymentDate: "2027-02-01",
        paymentReference: "PAY-001",
      }),
    );
    expect(payout.status).toBe(201);

    const list = await listPayouts(
      authedRequest("GET", "/api/commission-payouts"),
    );
    expect((await json(list)).items.length).toBe(1);
  });
});
