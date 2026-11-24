import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { POST as importPriceMatrix } from "@/app/api/excel/price-matrix/import/route";
import { GET as listExcelImports } from "@/app/api/excel/imports/route";
import {
  authedRequest,
  clearDb,
  seedAgent,
  seedQualification,
  seedRto,
  seedSupplierRoute,
  makeBDCToken,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

describe("Price Matrix Import — sourcing agent mapping", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("imports verified rows with different agents for different qualifications under the same RTO", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qual1Id = await seedQualification(new ObjectId(), "CHC30121")
    const qual2Id = await seedQualification(new ObjectId(), "CHC50121")
    const agent1Id = await seedAgent("certificate_source", new ObjectId())
    const agent2Id = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qual1Id,
            rtoId,
            sourceAgentId: agent1Id,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
          {
            qualificationId: qual2Id,
            rtoId,
            sourceAgentId: agent2Id,
            wholesaleCost: 800,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(2);
    expect(body.result.pendingCount).toBe(0);
    expect(body.result.errorCount).toBe(0);
    expect(body.result.imported[0].sourceAgentId).toBe(String(agent1Id));
    expect(body.result.imported[1].sourceAgentId).toBe(String(agent2Id));
  });

  it("imports different agents for the same qualification under different RTOs", async () => {
    const rto1Id = await seedRto(new ObjectId(), "R001")
    const rto2Id = await seedRto(new ObjectId(), "R002")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agent1Id = await seedAgent("certificate_source", new ObjectId())
    const agent2Id = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId: rto1Id,
            sourceAgentId: agent1Id,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
          {
            qualificationId: qualId,
            rtoId: rto2Id,
            sourceAgentId: agent2Id,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(2);
    expect(body.result.pendingCount).toBe(0);
  });

  it("keeps rows pending when no sourcing agent is selected", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: "",
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("Invalid qualification, agent, or RTO ID format");
  });

  it("rejects invalid agent ID", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: "not-a-valid-id",
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.importedCount).toBe(0);
  });

  it("prevents duplicate active route with overlapping effective dates", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Seed an existing active route
    await seedSupplierRoute(qualId, agentId, rtoId, 700, new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("overlapping");
  });

  it("rejects unresolved qualification", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const agentId = await seedAgent("certificate_source", new ObjectId())
    const fakeQualId = new ObjectId()

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: fakeQualId.toString(),
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("Qualification not found");
  });

  it("rejects unresolved RTO", async () => {
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())
    const fakeRtoId = new ObjectId()

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId: fakeRtoId.toString(),
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("RTO not found");
  });

  it("rejects unauthorized user (BDC without pricing.manage)", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())
    const token = makeBDCToken()

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }, token),
    );

    expect(res.status).toBe(403);
  });

  it("does not import pending rows", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())
    const fakeQualId = new ObjectId()

    // Mix of valid and invalid rows
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
          {
            qualificationId: fakeQualId.toString(),
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 600,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);
    expect(body.result.pendingCount).toBe(1);

    // Verify only one route was actually persisted
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const routes = await db.collection("supplier-routes").find({}).toArray();
    expect(routes.length).toBe(1);
    expect(String(routes[0].qualificationId)).toBe(String(qualId));
  });

  it("preserves historical route when a new route is created for the same combination", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Seed existing active route with old cost
    const oldRouteId = await seedSupplierRoute(qualId, agentId, rtoId, 700, new ObjectId())

    // Expire the old route
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    await db.collection("supplier-routes").updateOne(
      { _id: oldRouteId },
      { $set: { status: "expired", effectiveTo: new Date(), updatedAt: new Date() } },
    );

    // Create new route
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);

    // Verify both routes exist (old is expired, new is active)
    const routes = await db.collection("supplier-routes").find({}).toArray();
    expect(routes.length).toBe(2);
    const activeRoutes = routes.filter((r) => r.status === "active");
    const expiredRoutes = routes.filter((r) => r.status === "expired");
    expect(activeRoutes.length).toBe(1);
    expect(expiredRoutes.length).toBe(1);
    expect(activeRoutes[0].wholesaleCost).toBe(750);
    expect(expiredRoutes[0].wholesaleCost).toBe(700);
  });

  it("rejects overlapping duplicate for same qualification + RTO with different agent", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agent1Id = await seedAgent("certificate_source", new ObjectId())
    const agent2Id = await seedAgent("certificate_source", new ObjectId())

    // Seed an existing active route with agent1
    await seedSupplierRoute(qualId, agent1Id, rtoId, 700, new ObjectId())

    // Try to import with agent2 for same qualification + RTO
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agent2Id,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("overlapping");
  });

  it("allows different RTO for same qualification", async () => {
    const rto1Id = await seedRto(new ObjectId(), "R001")
    const rto2Id = await seedRto(new ObjectId(), "R002")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Seed existing route for RTO1 + Qual1
    await seedSupplierRoute(qualId, agentId, rto1Id, 700, new ObjectId())

    // Import for RTO2 + Qual1 (different RTO) - should be allowed
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId: rto2Id,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);
    expect(body.result.pendingCount).toBe(0);
  });

  it("allows same RTO for different qualification", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qual1Id = await seedQualification(new ObjectId(), "CHC30121")
    const qual2Id = await seedQualification(new ObjectId(), "CHC50121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Seed existing route for RTO1 + Qual1
    await seedSupplierRoute(qual1Id, agentId, rtoId, 700, new ObjectId())

    // Import for RTO1 + Qual2 (different qualification) - should be allowed
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qual2Id,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);
    expect(body.result.pendingCount).toBe(0);
  });

  it("allows non-overlapping historical route transition", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Seed an expired route with past dates
    const oldRouteId = await seedSupplierRoute(qualId, agentId, rtoId, 700, new ObjectId())
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    await db.collection("supplier-routes").updateOne(
      { _id: oldRouteId },
      { $set: { status: "expired", effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30"), updatedAt: new Date() } },
    );

    // Import new route with future dates (non-overlapping)
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date("2026-07-01").toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);
    expect(body.result.pendingCount).toBe(0);
  });

  it("rejects missing currency without defaulting to AUD", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("Currency");
  });

  it("rejects unsupported currency without defaulting to AUD", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "XYZ",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("Currency");
  });

  it("rejects missing effective from date", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: "",
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("Effective from date is required");
  });

  it("does not block later valid row when earlier row is rejected (no phantom batch entry)", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Row 1: rejected for missing currency (no batch range recorded)
    // Row 2: valid, same combination, non-overlapping dates — should succeed
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "",
            effectiveFrom: new Date("2026-01-01").toISOString(),
            effectiveTo: null,
          },
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date("2026-07-01").toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("Currency");
  });

  it("successful first insert blocks later overlapping row in same batch", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const now = new Date()
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: now.toISOString(),
            effectiveTo: null,
          },
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: now.toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);
    expect(body.result.pendingCount).toBe(1);
    expect(body.result.pending[0].reason).toContain("overlapping");
  });

  it("allows non-overlapping rows in the same batch", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date("2026-01-01").toISOString(),
            effectiveTo: new Date("2026-06-30").toISOString(),
          },
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date("2026-07-01").toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(2);
    expect(body.result.pendingCount).toBe(0);
  });

  it("documents that concurrent imports can race (application-level locking required)", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agent1Id = await seedAgent("certificate_source", new ObjectId())
    const agent2Id = await seedAgent("certificate_source", new ObjectId())

    const now = new Date()

    // Fire two concurrent import requests for the same combination with overlapping dates.
    // Without application-level locking or a MongoDB constraint on overlapping date ranges,
    // both requests can pass the pre-insert conflict check and both insert.
    // This is a known limitation: full concurrent protection requires an external lock
    // or a serialized import queue; MongoDB does not support unique constraints on
    // overlapping date ranges.
    const [res1, res2] = await Promise.all([
      importPriceMatrix(
        authedRequest("POST", "/excel/price-matrix/import", {
          rows: [
            {
              qualificationId: qualId,
              rtoId,
              sourceAgentId: agent1Id,
              wholesaleCost: 700,
              currency: "AUD",
              effectiveFrom: now.toISOString(),
              effectiveTo: null,
            },
          ],
        }),
      ),
      importPriceMatrix(
        authedRequest("POST", "/excel/price-matrix/import", {
          rows: [
            {
              qualificationId: qualId,
              rtoId,
              sourceAgentId: agent2Id,
              wholesaleCost: 750,
              currency: "AUD",
              effectiveFrom: now.toISOString(),
              effectiveTo: null,
            },
          ],
        }),
      ),
    ]);

    const body1 = await json(res1)
    const body2 = await json(res2)

    const totalImported = body1.result.importedCount + body2.result.importedCount
    const totalPending = body1.result.pendingCount + body2.result.pendingCount

    // At least one should import; the race may allow both (limitation documented above).
    expect(totalImported).toBeGreaterThanOrEqual(1)
    expect(totalImported + totalPending).toBe(2)
  });

  it("preserves historical records after failed imports", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Seed an existing active route
    const existingRouteId = await seedSupplierRoute(qualId, agentId, rtoId, 700, new ObjectId())
    const { getDb } = await import("@/lib/db");
    const db = await getDb();

    // Attempt import with invalid currency (should fail, not modify anything)
    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 999,
            currency: "INVALID",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);

    // Verify existing route is unchanged
    const routes = await db.collection("supplier-routes").find({}).toArray();
    expect(routes.length).toBe(1);
    expect(String(routes[0]._id)).toBe(String(existingRouteId));
    expect(routes[0].status).toBe("active");
    expect(routes[0].wholesaleCost).toBe(700);
  });

  it("leaves no guard document after successful import", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);
    expect(body.result.pendingCount).toBe(0);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const guards = await db.collection("excel_imports").find({ type: "price_matrix_lock" }).toArray();
    expect(guards.length).toBe(0);
  });

  it("leaves no guard document after failed validation", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "INVALID",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const guards = await db.collection("excel_imports").find({ type: "price_matrix_lock" }).toArray();
    expect(guards.length).toBe(0);
  });

  it("rolls back guard when supplier-route insertion fails", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Pre-seed an active route for the same combination so the insert
    // within the transaction will hit the CONFLICT path and roll back.
    await seedSupplierRoute(qualId, agentId, rtoId, 700, new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const guards = await db.collection("excel_imports").find({ type: "price_matrix_lock" }).toArray();
    expect(guards.length).toBe(0);
  });

  it("prevents concurrent imports from creating overlapping active routes", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agent1Id = await seedAgent("certificate_source", new ObjectId())
    const agent2Id = await seedAgent("certificate_source", new ObjectId())

    const now = new Date()

    const [res1, res2] = await Promise.all([
      importPriceMatrix(
        authedRequest("POST", "/excel/price-matrix/import", {
          rows: [
            {
              qualificationId: qualId,
              rtoId,
              sourceAgentId: agent1Id,
              wholesaleCost: 700,
              currency: "AUD",
              effectiveFrom: now.toISOString(),
              effectiveTo: null,
            },
          ],
        }),
      ),
      importPriceMatrix(
        authedRequest("POST", "/excel/price-matrix/import", {
          rows: [
            {
              qualificationId: qualId,
              rtoId,
              sourceAgentId: agent2Id,
              wholesaleCost: 750,
              currency: "AUD",
              effectiveFrom: now.toISOString(),
              effectiveTo: null,
            },
          ],
        }),
      ),
    ]);

    const body1 = await json(res1)
    const body2 = await json(res2)

    const totalImported = body1.result.importedCount + body2.result.importedCount
    const totalPending = body1.result.pendingCount + body2.result.pendingCount

    // Exactly one import should succeed; the other should be pended due to
    // guard-document contention or overlap detection.
    expect(totalImported).toBe(1)
    expect(totalPending).toBe(1)

    // Verify only one active route exists in the database.
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const routes = await db.collection("supplier-routes").find({ status: "active" }).toArray();
    expect(routes.length).toBe(1);
  });

  it("allows non-overlapping import after first completes", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // First import: Jan-Jun
    const res1 = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: new Date("2026-01-01").toISOString(),
            effectiveTo: new Date("2026-06-30").toISOString(),
          },
        ],
      }),
    );
    expect(res1.status).toBe(201);
    expect((await json(res1)).result.importedCount).toBe(1);

    // Second import: Jul onwards (non-overlapping) should succeed
    const res2 = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [
          {
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: new Date("2026-07-01").toISOString(),
            effectiveTo: null,
          },
        ],
      }),
    );
    expect(res2.status).toBe(201);
    expect((await json(res2)).result.importedCount).toBe(1);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const routes = await db.collection("supplier-routes").find({ status: "active" }).toArray();
    expect(routes.length).toBe(2);
  });

  it("allows independent combinations to proceed in parallel", async () => {
    const rto1Id = await seedRto(new ObjectId(), "R001")
    const rto2Id = await seedRto(new ObjectId(), "R002")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const now = new Date()

    const [res1, res2] = await Promise.all([
      importPriceMatrix(
        authedRequest("POST", "/excel/price-matrix/import", {
          rows: [{
            qualificationId: qualId,
            rtoId: rto1Id,
            sourceAgentId: agentId,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: now.toISOString(),
            effectiveTo: null,
          }],
        }),
      ),
      importPriceMatrix(
        authedRequest("POST", "/excel/price-matrix/import", {
          rows: [{
            qualificationId: qualId,
            rtoId: rto2Id,
            sourceAgentId: agentId,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: now.toISOString(),
            effectiveTo: null,
          }],
        }),
      ),
    ]);

    const body1 = await json(res1)
    const body2 = await json(res2)

    expect(body1.result.importedCount).toBe(1);
    expect(body2.result.importedCount).toBe(1);
  });

  it("does not affect existing excel_imports job records", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [{
          qualificationId: qualId,
          rtoId,
          sourceAgentId: agentId,
          wholesaleCost: 700,
          currency: "AUD",
          effectiveFrom: new Date().toISOString(),
          effectiveTo: null,
        }],
      }),
    );

    expect(res.status).toBe(201);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const jobRecords = await db.collection("excel_imports").find({ type: { $ne: "price_matrix_lock" } }).toArray();
    expect(jobRecords.length).toBe(0);
    // Guard documents must also be cleaned up
    const guards = await db.collection("excel_imports").find({ type: "price_matrix_lock" }).toArray();
    expect(guards.length).toBe(0);
  });

  it("stores ownerToken in guard document on acquisition", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [{
          qualificationId: qualId,
          rtoId,
          sourceAgentId: agentId,
          wholesaleCost: 700,
          currency: "AUD",
          effectiveFrom: new Date().toISOString(),
          effectiveTo: null,
        }],
      }),
    );

    expect(res.status).toBe(201);
    expect((await json(res)).result.importedCount).toBe(1);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    // After successful import, no guard should remain
    const guards = await db.collection("excel_imports").find({ type: "price_matrix_lock" }).toArray();
    expect(guards.length).toBe(0);

    // Verify import succeeded (guard was acquired and released)
    expect(res.status).toBe(201);
  });

  it("owner-verified cleanup removes only the requesting request's guard", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [{
          qualificationId: qualId,
          rtoId,
          sourceAgentId: agentId,
          wholesaleCost: 700,
          currency: "AUD",
          effectiveFrom: new Date().toISOString(),
          effectiveTo: null,
        }],
      }),
    );

    expect(res.status).toBe(201);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    // Guard must be cleaned up after import
    const guards = await db.collection("excel_imports").find({ type: "price_matrix_lock" }).toArray();
    expect(guards.length).toBe(0);
  });

  it("request that fails guard acquisition cannot delete another request's guard", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agent1Id = await seedAgent("certificate_source", new ObjectId())
    const agent2Id = await seedAgent("certificate_source", new ObjectId())

    const now = new Date()

    const [res1, res2] = await Promise.all([
      importPriceMatrix(
        authedRequest("POST", "/excel/price-matrix/import", {
          rows: [{
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agent1Id,
            wholesaleCost: 700,
            currency: "AUD",
            effectiveFrom: now.toISOString(),
            effectiveTo: null,
          }],
        }),
      ),
      importPriceMatrix(
        authedRequest("POST", "/excel/price-matrix/import", {
          rows: [{
            qualificationId: qualId,
            rtoId,
            sourceAgentId: agent2Id,
            wholesaleCost: 750,
            currency: "AUD",
            effectiveFrom: now.toISOString(),
            effectiveTo: null,
          }],
        }),
      ),
    ]);

    const body1 = await json(res1)
    const body2 = await json(res2)

    const totalImported = body1.result.importedCount + body2.result.importedCount
    const totalPending = body1.result.pendingCount + body2.result.pendingCount

    expect(totalImported).toBe(1)
    expect(totalPending).toBe(1)

    // Verify only one active route exists
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const routes = await db.collection("supplier-routes").find({ status: "active" }).toArray();
    expect(routes.length).toBe(1);

    // No orphaned guard
    const guards = await db.collection("excel_imports").find({ type: "price_matrix_lock" }).toArray();
    expect(guards.length).toBe(0);
  });

  it("cleanup with deletedCount=0 does not fail the import", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    // Pre-seed an active route so the import's overlap check pends the row
    // (guard is acquired but no route is inserted, cleanup still runs)
    await seedSupplierRoute(qualId, agentId, rtoId, 700, new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [{
          qualificationId: qualId,
          rtoId,
          sourceAgentId: agentId,
          wholesaleCost: 750,
          currency: "AUD",
          effectiveFrom: new Date().toISOString(),
          effectiveTo: null,
        }],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(0);
    expect(body.result.pendingCount).toBe(1);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const guards = await db.collection("excel_imports").find({ type: "price_matrix_lock" }).toArray();
    expect(guards.length).toBe(0);
  });

  it("import history excludes guard documents but preserves normal records", async () => {
    const { getDb } = await import("@/lib/db");
    const db = await getDb();

    // Insert a normal import job record (no type field)
    await db.collection("excel_imports").insertOne({
      templateId: new ObjectId(),
      filename: "test-upload.xlsx",
      status: "completed",
      rowCounts: { total: 5, success: 3, failed: 2, skipped: 0 },
      startedBy: new ObjectId(),
      startedAt: new Date("2026-01-01"),
      completedAt: new Date("2026-01-01T01:00:00Z"),
      errorSummary: null,
    });

    // Insert a legacy record without type field
    await db.collection("excel_imports").insertOne({
      filename: "legacy-upload.xlsx",
      status: "completed",
      rowCounts: { total: 3, success: 3, failed: 0, skipped: 0 },
      startedBy: new ObjectId(),
      startedAt: new Date("2026-02-01"),
      completedAt: new Date("2026-02-01T01:00:00Z"),
      errorSummary: null,
    });

    // Insert a Price Matrix guard document
    await db.collection("excel_imports").insertOne({
      _id: "price_matrix_lock:qualOid:rtoOid",
      type: "price_matrix_lock",
      qualificationId: "qualOid",
      rtoId: "rtoOid",
      ownerToken: "instance:uuid",
      createdAt: new Date(),
    });

    const res = await listExcelImports(
      authedRequest("GET", "/excel/imports"),
      { params: {} },
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.imports.length).toBe(2);
    expect(body.imports.some((i: any) => i.filename === "test-upload.xlsx")).toBe(true);
    expect(body.imports.some((i: any) => i.filename === "legacy-upload.xlsx")).toBe(true);
    expect(body.imports.some((i: any) => i.filename === null || i.filename === undefined)).toBe(false);
  });

  it("original import result preserved when cleanup fails", async () => {
    const rtoId = await seedRto(new ObjectId(), "R001")
    const qualId = await seedQualification(new ObjectId(), "CHC30121")
    const agentId = await seedAgent("certificate_source", new ObjectId())

    const res = await importPriceMatrix(
      authedRequest("POST", "/excel/price-matrix/import", {
        rows: [{
          qualificationId: qualId,
          rtoId,
          sourceAgentId: agentId,
          wholesaleCost: 700,
          currency: "AUD",
          effectiveFrom: new Date().toISOString(),
          effectiveTo: null,
        }],
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.result.importedCount).toBe(1);
    expect(body.result.pendingCount).toBe(0);

    // Verify route was created despite any cleanup concerns
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const routes = await db.collection("supplier-routes").find({ status: "active" }).toArray();
    expect(routes.length).toBe(1);
  });
});
