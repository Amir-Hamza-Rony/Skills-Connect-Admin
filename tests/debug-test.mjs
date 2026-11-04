import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { POST as createOrder } from "@/app/api/orders/route";
import { authedRequest, clearDb, seedClient, seedQualification, seedRto, seedAgent, seedPriceCategory, seedPriceList, seedSupplierRoute, seedMapping } from "./helpers";

function json(res) { return res.json(); }

describe("debug order creation", () => {
  beforeEach(async () => { await clearDb(); });

  it("creates an order via API", async () => {
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent("sales_closing");
    const rId = await seedRto();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
    await seedSupplierRoute(qId, aId, rId, 1500);
    await seedMapping(qId, rId);

    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(aId),
        rtoId: String(rId),
        sellingPrice: 5000,
      }),
    );
    console.log("STATUS:", res.status);
    const body = await json(res);
    console.log("BODY:", JSON.stringify(body, null, 2));
    expect(res.status).toBe(201);
  });
});
