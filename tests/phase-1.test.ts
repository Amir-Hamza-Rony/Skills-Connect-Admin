import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { POST as createMaster, GET as listMasters } from "@/app/api/masters/[type]/route";
import { PATCH as updateMaster } from "@/app/api/masters/[type]/[id]/route";
import { POST as createMapping, GET as listMappings } from "@/app/api/masters/qualification-rto-mappings/route";
import { PATCH as updateMapping, DELETE as deleteMapping } from "@/app/api/masters/qualification-rto-mappings/[id]/route";

import { authedRequest, clearDb } from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

describe("Phase 1 — Qualification management", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates a qualification and normalises the code to uppercase", async () => {
    const res = await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "aur32120",
        title: "Certificate III",
        trainingPackage: "AUR",
        industry: "Automotive",
        status: "current",
      }),
      { params: { type: "qualifications" } },
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.code).toBe("AUR32120");
    expect(body.title).toBe("Certificate III");
  });

  it("prevents duplicate qualification codes (case-insensitive)", async () => {
    await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "AUR32120",
        title: "One",
        trainingPackage: "AUR",
        industry: "Automotive",
        status: "current",
      }),
      { params: { type: "qualifications" } },
    );
    const dup = await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "aur32120",
        title: "Two",
        trainingPackage: "AUR",
        industry: "Automotive",
        status: "current",
      }),
      { params: { type: "qualifications" } },
    );
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.code).toBe("CONFLICT");
  });

  it("lists qualifications with search and status filter and pagination", async () => {
    await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "AUR32120",
        title: "Cert III Auto",
        trainingPackage: "AUR",
        industry: "Automotive",
        status: "current",
      }),
      { params: { type: "qualifications" } },
    );
    await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "SIT20316",
        title: "Cert II Hospitality",
        trainingPackage: "SIT",
        industry: "Hospitality",
        status: "superseded",
      }),
      { params: { type: "qualifications" } },
    );

    const list = await listMasters(
      authedRequest("GET", "/api/masters/qualifications?search=auto&status=current"),
      { params: { type: "qualifications" } },
    );
    expect(list.status).toBe(200);
    const body = await json(list);
    expect(body.items.length).toBe(1);
    expect(body.items[0].code).toBe("AUR32120");
  });

  it("updates a qualification and prevents code conflict on update", async () => {
    const a = await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "AAA100",
        title: "A",
        trainingPackage: "A",
        industry: "Auto",
        status: "current",
      }),
      { params: { type: "qualifications" } },
    );
    const b = await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "BBB200",
        title: "B",
        trainingPackage: "B",
        industry: "Auto",
        status: "current",
      }),
      { params: { type: "qualifications" } },
    );
    const idA = (await json(a)).id;
    const idB = (await json(b)).id;

    // Update A to B's code -> conflict.
    const conflict = await updateMaster(
      authedRequest("PATCH", `/api/masters/qualifications/${idA}`, {
        code: "BBB200",
      }),
      { params: { type: "qualifications", id: idA } },
    );
    expect(conflict.status).toBe(409);

    // Valid update.
    const updated = await updateMaster(
      authedRequest("PATCH", `/api/masters/qualifications/${idA}`, {
        title: "Renamed",
        status: "superseded",
      }),
      { params: { type: "qualifications", id: idA } },
    );
    expect(updated.status).toBe(200);
    const body = await json(updated);
    expect(body.item.title).toBe("Renamed");
    expect(body.item.status).toBe("superseded");
  });

  it("rejects invalid status and missing fields", async () => {
    const badStatus = await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "XXX",
        title: "T",
        trainingPackage: "P",
        industry: "I",
        status: "not-a-status",
      }),
      { params: { type: "qualifications" } },
    );
    expect(badStatus.status).toBe(400);

    const missing = await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "XXX",
      }),
      { params: { type: "qualifications" } },
    );
    expect(missing.status).toBe(400);
  });

  it("returns 404 for a missing qualification on update", async () => {
    const res = await updateMaster(
      authedRequest("PATCH", "/api/masters/qualifications/000000000000000000000000", {
        title: "X",
      }),
      { params: { type: "qualifications", id: "000000000000000000000000" } },
    );
    expect(res.status).toBe(404);
  });
});

describe("Phase 1 — RTO management", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates an RTO and normalises the code to uppercase", async () => {
    const res = await createMaster(
      authedRequest("POST", "/api/masters/rtos", {
        legalName: "Demo College Pty Ltd",
        tradingName: "Demo College",
        rtoCode: "demo4",
        status: "active",
      }),
      { params: { type: "rtos" } },
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.rtoCode).toBe("DEMO4");
  });

  it("prevents duplicate RTO codes", async () => {
    await createMaster(
      authedRequest("POST", "/api/masters/rtos", {
        legalName: "One",
        tradingName: "One",
        rtoCode: "R001",
        status: "active",
      }),
      { params: { type: "rtos" } },
    );
    const dup = await createMaster(
      authedRequest("POST", "/api/masters/rtos", {
        legalName: "Two",
        tradingName: "Two",
        rtoCode: "r001",
        status: "active",
      }),
      { params: { type: "rtos" } },
    );
    expect(dup.status).toBe(409);
  });

  it("activates/deactivates an RTO via update", async () => {
    const res = await createMaster(
      authedRequest("POST", "/api/masters/rtos", {
        legalName: "One",
        tradingName: "One",
        rtoCode: "R001",
        status: "active",
      }),
      { params: { type: "rtos" } },
    );
    const id = (await json(res)).id;

    const deactivated = await updateMaster(
      authedRequest("PATCH", `/api/masters/rtos/${id}`, { status: "inactive" }),
      { params: { type: "rtos", id } },
    );
    expect(deactivated.status).toBe(200);
    expect((await json(deactivated)).item.status).toBe("inactive");
  });
});

describe("Phase 1 — Agent management", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates agents with Sales and Source types", async () => {
    const sales = await createMaster(
      authedRequest("POST", "/api/masters/agents", {
        name: "Alice",
        type: "sales_closing",
        contact: "alice@example.com",
      }),
      { params: { type: "agents" } },
    );
    expect(sales.status).toBe(201);

    const source = await createMaster(
      authedRequest("POST", "/api/masters/agents", {
        name: "Bob",
        type: "certificate_source",
        contact: "bob@example.com",
      }),
      { params: { type: "agents" } },
    );
    expect(source.status).toBe(201);

    const list = await listMasters(
      authedRequest("GET", "/api/masters/agents"),
      { params: { type: "agents" } },
    );
    const body = await json(list);
    expect(body.items.length).toBe(2);
  });

  it("prevents duplicate agent name+contact", async () => {
    await createMaster(
      authedRequest("POST", "/api/masters/agents", {
        name: "Alice",
        type: "sales_closing",
        contact: "alice@example.com",
      }),
      { params: { type: "agents" } },
    );
    const dup = await createMaster(
      authedRequest("POST", "/api/masters/agents", {
        name: "Alice",
        type: "certificate_source",
        contact: "alice@example.com",
      }),
      { params: { type: "agents" } },
    );
    expect(dup.status).toBe(409);
  });

  it("updates an agent and toggles active status", async () => {
    const res = await createMaster(
      authedRequest("POST", "/api/masters/agents", {
        name: "Alice",
        type: "sales_closing",
        contact: "alice@example.com",
        active: true,
      }),
      { params: { type: "agents" } },
    );
    const id = (await json(res)).id;

    const updated = await updateMaster(
      authedRequest("PATCH", `/api/masters/agents/${id}`, { active: false }),
      { params: { type: "agents", id } },
    );
    expect(updated.status).toBe(200);
    expect((await json(updated)).item.active).toBe(false);
  });
});

describe("Phase 1 — Qualification–RTO mapping", () => {
  beforeEach(async () => {
    await clearDb();
  });

  async function seedQualAndRto() {
    const q = await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "AUR32120",
        title: "Cert III",
        trainingPackage: "AUR",
        industry: "Auto",
        status: "current",
      }),
      { params: { type: "qualifications" } },
    );
    const r = await createMaster(
      authedRequest("POST", "/api/masters/rtos", {
        legalName: "Demo College",
        tradingName: "Demo",
        rtoCode: "R001",
        status: "active",
      }),
      { params: { type: "rtos" } },
    );
    return { qId: (await json(q)).id, rId: (await json(r)).id };
  }

  it("creates a mapping and prevents duplicates", async () => {
    const { qId, rId } = await seedQualAndRto();

    const created = await createMapping(
      authedRequest("POST", "/api/masters/qualification-rto-mappings", {
        qualificationId: qId,
        rtoId: rId,
        status: "active",
      }),
    );
    expect(created.status).toBe(201);

    const dup = await createMapping(
      authedRequest("POST", "/api/masters/qualification-rto-mappings", {
        qualificationId: qId,
        rtoId: rId,
        status: "inactive",
      }),
    );
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.code).toBe("CONFLICT");
  });

  it("rejects mapping with invalid qualification or rto reference", async () => {
    const badQual = await createMapping(
      authedRequest("POST", "/api/masters/qualification-rto-mappings", {
        qualificationId: new ObjectId().toString(),
        rtoId: new ObjectId().toString(),
      }),
    );
    expect(badQual.status).toBe(404);

    const { qId } = await seedQualAndRto();
    const badRto = await createMapping(
      authedRequest("POST", "/api/masters/qualification-rto-mappings", {
        qualificationId: qId,
        rtoId: new ObjectId().toString(),
      }),
    );
    expect(badRto.status).toBe(404);
  });

  it("lists mappings filtered by qualification and rto", async () => {
    const { qId, rId } = await seedQualAndRto();
    await createMapping(
      authedRequest("POST", "/api/masters/qualification-rto-mappings", {
        qualificationId: qId,
        rtoId: rId,
        status: "active",
      }),
    );

    const byQual = await listMappings(
      authedRequest("GET", `/api/masters/qualification-rto-mappings?qualificationId=${qId}`),
    );
    expect((await json(byQual)).items.length).toBe(1);

    const byRto = await listMappings(
      authedRequest("GET", `/api/masters/qualification-rto-mappings?rtoId=${rId}`),
    );
    expect((await json(byRto)).items.length).toBe(1);

    const inactive = await listMappings(
      authedRequest("GET", "/api/masters/qualification-rto-mappings?status=inactive"),
    );
    expect((await json(inactive)).items.length).toBe(0);
  });

  it("updates and deletes a mapping", async () => {
    const { qId, rId } = await seedQualAndRto();
    const created = await createMapping(
      authedRequest("POST", "/api/masters/qualification-rto-mappings", {
        qualificationId: qId,
        rtoId: rId,
        status: "active",
      }),
    );
    const id = (await json(created)).mapping.id;

    const updated = await updateMapping(
      authedRequest("PATCH", `/api/masters/qualification-rto-mappings/${id}`, {
        status: "inactive",
      }),
      { params: { id } },
    );
    expect(updated.status).toBe(200);
    expect((await json(updated)).mapping.status).toBe("inactive");

    const removed = await deleteMapping(
      authedRequest("DELETE", `/api/masters/qualification-rto-mappings/${id}`),
      { params: { id } },
    );
    expect(removed.status).toBe(200);

    const gone = await listMappings(
      authedRequest("GET", "/api/masters/qualification-rto-mappings"),
    );
    expect((await json(gone)).items.length).toBe(0);
  });
});

describe("Phase 1 — Supplier route dedupe and history", () => {
  beforeEach(async () => {
    await clearDb();
  });

  async function seedRouteEntities() {
    const q = await createMaster(
      authedRequest("POST", "/api/masters/qualifications", {
        code: "AUR32120",
        title: "Cert III",
        trainingPackage: "AUR",
        industry: "Auto",
        status: "current",
      }),
      { params: { type: "qualifications" } },
    );
    const a = await createMaster(
      authedRequest("POST", "/api/masters/agents", {
        name: "Source Agent",
        type: "certificate_source",
        contact: "src@example.com",
      }),
      { params: { type: "agents" } },
    );
    const r = await createMaster(
      authedRequest("POST", "/api/masters/rtos", {
        legalName: "Demo College",
        tradingName: "Demo",
        rtoCode: "R001",
        status: "active",
      }),
      { params: { type: "rtos" } },
    );
    return {
      qId: (await json(q)).id,
      aId: (await json(a)).id,
      rId: (await json(r)).id,
    };
  }

  it("prevents duplicate active supplier routes with overlapping windows", async () => {
    const { qId, aId, rId } = await seedRouteEntities();

    await createMaster(
      authedRequest("POST", "/api/masters/supplier-routes", {
        qualificationId: qId,
        sourceAgentId: aId,
        rtoId: rId,
        wholesaleCost: 1000,
        currency: "AUD",
        effectiveFrom: "2027-01-01",
        effectiveTo: null,
        status: "active",
      }),
      { params: { type: "supplier-routes" } },
    );

    const dup = await createMaster(
      authedRequest("POST", "/api/masters/supplier-routes", {
        qualificationId: qId,
        sourceAgentId: aId,
        rtoId: rId,
        wholesaleCost: 2000,
        currency: "AUD",
        effectiveFrom: "2027-06-01",
        effectiveTo: null,
        status: "active",
      }),
      { params: { type: "supplier-routes" } },
    );
    expect(dup.status).toBe(409);
  });

  it("allows non-overlapping active routes for same qualification/agent/rto", async () => {
    const { qId, aId, rId } = await seedRouteEntities();

    await createMaster(
      authedRequest("POST", "/api/masters/supplier-routes", {
        qualificationId: qId,
        sourceAgentId: aId,
        rtoId: rId,
        wholesaleCost: 1000,
        currency: "AUD",
        effectiveFrom: "2027-01-01",
        effectiveTo: "2027-06-30",
        status: "active",
      }),
      { params: { type: "supplier-routes" } },
    );

    const next = await createMaster(
      authedRequest("POST", "/api/masters/supplier-routes", {
        qualificationId: qId,
        sourceAgentId: aId,
        rtoId: rId,
        wholesaleCost: 2000,
        currency: "AUD",
        effectiveFrom: "2027-07-01",
        effectiveTo: null,
        status: "active",
      }),
      { params: { type: "supplier-routes" } },
    );
    expect(next.status).toBe(201);
  });

  it("validates that qualification, agent and rto exist for a route", async () => {
    const res = await createMaster(
      authedRequest("POST", "/api/masters/supplier-routes", {
        qualificationId: new ObjectId().toString(),
        sourceAgentId: new ObjectId().toString(),
        rtoId: new ObjectId().toString(),
        wholesaleCost: 1000,
        currency: "AUD",
        effectiveFrom: "2027-01-01",
        status: "active",
      }),
      { params: { type: "supplier-routes" } },
    );
    expect(res.status).toBe(404);
  });
});
