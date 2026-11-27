/**
 * Phase 1 — M1.2 foundation: types, validation, enrollment codes, and indexes.
 *
 * All fixtures are seeded into the in-memory replica set (tests/setup.ts).
 * No production database, migration, seed, or backfill is involved.
 */

import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  ENROLLMENT_CODE_PATTERN,
  formatEnrollmentCode,
  nextEnrollmentCode,
} from "@/lib/enrollment-code";
import {
  isValidDateString,
  isValidEmail,
  isValidObjectIdString,
  normalizeEmail,
  normalizeOptionalString,
  referencedClientExists,
} from "@/lib/client-validation";
import { ORDER_STATUS_GROUPS } from "@/lib/types";
import {
  checkUniquePartialSafety,
  findDuplicateNonEmptyStrings,
  M1_INDEXES,
} from "../scripts/migrate-phase-1-m1.mjs";
import {
  authedRequest,
  clearDb,
  makeAdminToken,
  makeB2BAgentToken,
  makeBDCToken,
  makeSuperAdminToken,
  seedClient,
  seedOrder,
} from "./helpers";

// Use `undefined` to keep the existing fixture defaults while supplying overrides.
const withOrder = (overrides: Record<string, unknown>) =>
  seedOrder(undefined, undefined, undefined, undefined, undefined, undefined, overrides);
const withClient = (overrides: Record<string, unknown>) =>
  seedClient(undefined, undefined, undefined, overrides);

async function applyM1Indexes() {
  const db = await getDb();
  for (const { coll, keys, options } of M1_INDEXES) {
    await db.collection(coll).createIndex(keys, options);
  }
}

beforeEach(async () => {
  await clearDb();
});

describe("M1.2 — enrollment code format and generation", () => {
  it("formats SC-YYYY-NNNN with zero padding", () => {
    expect(formatEnrollmentCode(2026, 1)).toBe("SC-2026-0001");
    expect(formatEnrollmentCode(2026, 1042)).toBe("SC-2026-1042");
    expect(formatEnrollmentCode(2027, 12345)).toBe("SC-2027-12345");
    expect(ENROLLMENT_CODE_PATTERN.test("SC-2026-0001")).toBe(true);
    expect(ENROLLMENT_CODE_PATTERN.test("SC-2026-1")).toBe(false);
    expect(ENROLLMENT_CODE_PATTERN.test("RPL-2026-1001")).toBe(false);
  });

  it("allocates sequential codes within a year", async () => {
    expect(await nextEnrollmentCode(2026)).toBe("SC-2026-0001");
    expect(await nextEnrollmentCode(2026)).toBe("SC-2026-0002");
  });

  it("rolls over the year prefix", async () => {
    expect(await nextEnrollmentCode(2027)).toBe("SC-2027-0001");
  });

  it("produces unique codes under concurrent creation", async () => {
    const codes = await Promise.all(
      Array.from({ length: 25 }, () => nextEnrollmentCode(2026)),
    );
    expect(new Set(codes).size).toBe(25);
    expect(codes.every((code) => ENROLLMENT_CODE_PATTERN.test(code))).toBe(true);
  });
});

describe("M1.2 — read-only duplicate preflight", () => {
  it("reports duplicated non-empty strings with counts and creates no indexes", async () => {
    const db = await getDb();
    await withOrder({ enrollmentCode: "SC-2026-0001" });
    await withOrder({ enrollmentCode: "SC-2026-0001" });
    await withOrder({ enrollmentCode: "SC-2026-0002" });
    await withOrder({ enrollmentCode: null });
    await withClient({ usiNumber: "USI123" });
    await withClient({ usiNumber: "USI123" });

    expect(await findDuplicateNonEmptyStrings(db, "orders", "enrollmentCode")).toEqual([
      { value: "SC-2026-0001", count: 2 },
    ]);
    expect(await findDuplicateNonEmptyStrings(db, "clients", "usiNumber")).toEqual([
      { value: "USI123", count: 2 },
    ]);

    const findings = await checkUniquePartialSafety(db);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ coll: "orders", field: "enrollmentCode" });
    expect(findings[1]).toMatchObject({ coll: "clients", field: "usiNumber" });

    const indexes = await db.collection("orders").listIndexes().toArray();
    expect(indexes.some((i: any) => i.name === "uniq_orders_enrollment_code")).toBe(false);
  });

  it("passes preflight when values are missing, null, or empty strings", async () => {
    const db = await getDb();
    await withOrder({ enrollmentCode: null });
    await withOrder({ enrollmentCode: "" });
    await withOrder({}); // missing
    await withOrder({ enrollmentCode: "SC-2026-0001" });
    await withClient({ usiNumber: null });
    await withClient({ usiNumber: "" });
    await withClient({}); // missing
    await withClient({ usiNumber: "USI123" });

    expect(await checkUniquePartialSafety(db)).toEqual([]);
  });
});

describe("M1.2 — unique partial index options and MongoDB behavior", () => {
  it("creates the exact unique partial index options", async () => {
    const db = await getDb();
    await applyM1Indexes();

    const orderIndexes = await db.collection("orders").listIndexes().toArray();
    const codeIdx = orderIndexes.find((i: any) => i.name === "uniq_orders_enrollment_code");
    expect(codeIdx).toBeDefined();
    expect(codeIdx.key).toEqual({ enrollmentCode: 1 });
    expect(codeIdx.unique).toBe(true);
    expect(Boolean(codeIdx.sparse)).toBe(false);
    expect(codeIdx.partialFilterExpression).toEqual({
      $and: [
        { enrollmentCode: { $type: "string" } },
        { enrollmentCode: { $gt: "" } },
      ],
    });

    const clientIndexes = await db.collection("clients").listIndexes().toArray();
    const usiIdx = clientIndexes.find((i: any) => i.name === "uniq_clients_usi_number");
    expect(usiIdx).toBeDefined();
    expect(usiIdx.key).toEqual({ usiNumber: 1 });
    expect(usiIdx.unique).toBe(true);
    expect(Boolean(usiIdx.sparse)).toBe(false);
    expect(usiIdx.partialFilterExpression).toEqual({
      $and: [
        { usiNumber: { $type: "string" } },
        { usiNumber: { $gt: "" } },
      ],
    });

    // B11: email must remain non-unique.
    const emailIdx = clientIndexes.find((i: any) => i.name === "idx_clients_email");
    expect(Boolean(emailIdx?.unique)).toBe(false);
  });

  it("allows unlimited missing, null, and empty-string legacy values", async () => {
    const db = await getDb();
    await applyM1Indexes();

    await withOrder({ enrollmentCode: "SC-2026-0001" }); // before legacy rows
    await withOrder({ enrollmentCode: null });
    await withOrder({ enrollmentCode: "" });
    await withOrder({}); // missing
    await withOrder({ enrollmentCode: null });
    await withOrder({ enrollmentCode: "" });
    await withOrder({}); // missing
    expect(await db.collection("orders").countDocuments()).toBe(7);

    await withClient({ usiNumber: "USI123" });
    await withClient({ usiNumber: null });
    await withClient({ usiNumber: "" });
    await withClient({}); // missing
    await withClient({ usiNumber: null });
    await withClient({ usiNumber: "" });
    await withClient({}); // missing
    expect(await db.collection("clients").countDocuments()).toBe(7);
  });

  it("rejects duplicate valid strings with E11000", async () => {
    const db = await getDb();
    await applyM1Indexes();

    await withOrder({ enrollmentCode: "SC-2026-0001" });
    await expect(withOrder({ enrollmentCode: "SC-2026-0001" }))
      .rejects.toMatchObject({ code: 11000 });
    expect(await db.collection("orders").countDocuments()).toBe(1);

    await withClient({ usiNumber: "USI123" });
    await expect(withClient({ usiNumber: "USI123" }))
      .rejects.toMatchObject({ code: 11000 });
    expect(await db.collection("clients").countDocuments()).toBe(1);
  });

  it("does not index non-string values", async () => {
    const db = await getDb();
    await applyM1Indexes();

    await withOrder({ enrollmentCode: 12345 });
    await withOrder({ enrollmentCode: 12345 });
    expect(await db.collection("orders").countDocuments()).toBe(2);

    await withClient({ usiNumber: 999 });
    await withClient({ usiNumber: 999 });
    expect(await db.collection("clients").countDocuments()).toBe(2);
  });

  it("fails index creation when duplicate valid values already exist", async () => {
    await withOrder({ enrollmentCode: "SC-2026-0001" });
    await withOrder({ enrollmentCode: "SC-2026-0001" });
    await expect(applyM1Indexes()).rejects.toMatchObject({ code: 11000 });
  });
});

describe("M1.2 — validation helpers", () => {
  it("normalizes and validates email", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail(123)).toBe(false);
  });

  it("normalizes optional strings and validates dates/ObjectIds", async () => {
    expect(normalizeOptionalString("  hello  ")).toBe("hello");
    expect(normalizeOptionalString("   ")).toBeNull();
    expect(normalizeOptionalString(null)).toBeNull();
    expect(normalizeOptionalString(undefined)).toBeNull();

    expect(isValidDateString("2026-11-17")).toBe(true);
    expect(isValidDateString("not-a-date")).toBe(false);
    expect(isValidObjectIdString(new ObjectId().toString())).toBe(true);
    expect(isValidObjectIdString("nope")).toBe(false);

    const clientId = await seedClient();
    expect(await referencedClientExists(String(clientId))).toBe(true);
    expect(await referencedClientExists(String(new ObjectId()))).toBe(false);
    expect(await referencedClientExists("bad")).toBe(false);
  });
});

describe("M1.2 — frozen order status workflow regression", () => {
  it("exposes the application statuses from the docs", () => {
    const expected = [
      "DRAFT", "RECEIVED", "IN_PROGRESS", "DELIVERED", "ON_HOLD", "CANCELLED",
      "Lead", "Qualified", "Won", "Lost", "New", "Awaiting Payment",
      "Awaiting Documents", "Documents Under Review", "Ready for Submission",
      "Submitted to Source Agent", "Submitted to RTO", "RTO Acknowledged",
      "Under Assessment", "Additional Evidence Required", "Rework Required",
      "Approved", "Certificate Issued", "Completed",
    ];
    const actual = ORDER_STATUS_GROUPS.flatMap((group) => group.statuses);
    expect(new Set(actual).size).toBeGreaterThanOrEqual(24);
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});

/* ───────────────────────── M1.3 — Client API & integrity ───────────────────────── */

const BDC_1 = "m13-bdc-1";
const BDC_2 = "m13-bdc-2";

const PII_FIELDS = ["dob", "usiNumber", "visaStatus"] as const;

function expectNoPii(client: Record<string, unknown>) {
  for (const field of PII_FIELDS) {
    expect(field in client).toBe(false);
  }
}

describe("M1.3 — client create contract and validation", () => {
  it("persists contacts/addresses and new student fields, returns a full {client} envelope, lowercases email and audits", async () => {
    const { POST } = await import("@/app/api/clients/route");
    const payload = {
      legalName: "  Jane Doe  ",
      preferredName: "  Jane  ",
      email: "  Jane@Example.COM ",
      phone: " 0400 123 456 ",
      status: "Active",
      notes: "VIP",
      contacts: [
        { label: "Mobile", type: "phone", value: "0400 123 456", primary: true },
        { label: "Email", type: "email", value: "jane@example.com", primary: true },
      ],
      addresses: [
        { label: "Home", street: "1 Main St", city: "Sydney", state: "NSW", postalCode: "2000", country: "Australia", primary: true },
      ],
      dob: "2000-01-31",
      usiNumber: "USI-JANE-001",
      visaStatus: "Student Visa",
      externalReferrerName: "Referrer A",
    };
    const res = await POST(authedRequest("POST", "/api/clients", payload, makeSuperAdminToken()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client).toBeDefined();
    expect(body.client.legalName).toBe("Jane Doe");
    expect(body.client.preferredName).toBe("Jane");
    expect(body.client.email).toBe("jane@example.com");
    expect(body.client.phone).toBe("0400 123 456");
    expect(body.client.status).toBe("Active");
    expect(body.client.contacts).toHaveLength(2);
    expect(body.client.addresses).toHaveLength(1);
    expect(body.client.id).toBeDefined();
    expect(body.client.createdAt).toBeDefined();
    expectNoPii(body.client); // B8: no PII projection shipped in M1.3

    const db = await getDb();
    const stored = await db.collection("clients").findOne({ email: "jane@example.com" });
    expect(stored).not.toBeNull();
    expect(stored!.contacts).toHaveLength(2);
    expect(stored!.addresses).toHaveLength(1);
    expect(stored!.dob).toBe("2000-01-31");
    expect(stored!.usiNumber).toBe("USI-JANE-001");
    expect(stored!.visaStatus).toBe("Student Visa");
    expect(stored!.externalReferrerName).toBe("Referrer A");

    const audit = await db.collection("audit_logs").findOne({ entityType: "client", action: "create" });
    expect(audit).not.toBeNull();
    expect(audit!.entityId).toBe(String(stored!._id));
  });

  it("rejects malformed email, invalid dob, missing fields and duplicate email", async () => {
    const { POST } = await import("@/app/api/clients/route");
    const token = makeSuperAdminToken();
    expect((await POST(authedRequest("POST", "/api/clients", { email: "not-an-email", legalName: "A" }, token))).status).toBe(400);
    expect((await POST(authedRequest("POST", "/api/clients", { email: "a@b.com", legalName: "A", dob: "not-a-date" }, token))).status).toBe(400);
    expect((await POST(authedRequest("POST", "/api/clients", { email: "a@b.com" }, token))).status).toBe(400);
    expect((await POST(authedRequest("POST", "/api/clients", { legalName: "A" }, token))).status).toBe(400);

    const first = await POST(authedRequest("POST", "/api/clients", { legalName: "A", email: "dupe@example.com" }, token));
    expect(first.status).toBe(201);
    const second = await POST(authedRequest("POST", "/api/clients", { legalName: "B", email: " DUPE@EXAMPLE.COM " }, token));
    expect(second.status).toBe(409);
  });

  it("rejects invalid or non-existent referral targets", async () => {
    const { POST } = await import("@/app/api/clients/route");
    const token = makeSuperAdminToken();
    const bad = await POST(authedRequest("POST", "/api/clients", {
      legalName: "Ref", email: "ref@example.com", referredByStudentId: "not-an-object-id",
    }, token));
    expect(bad.status).toBe(400);
    const missing = await POST(authedRequest("POST", "/api/clients", {
      legalName: "Ref", email: "ref@example.com", referredByStudentId: String(new ObjectId()),
    }, token));
    expect(missing.status).toBe(400);
  });

  it("accepts a valid referral to an existing client", async () => {
    const target = await seedClient();
    const { POST } = await import("@/app/api/clients/route");
    const res = await POST(authedRequest("POST", "/api/clients", {
      legalName: "Referred", email: "referred@example.com", referredByStudentId: String(target),
    }, makeSuperAdminToken()));
    expect(res.status).toBe(201);
    const db = await getDb();
    const stored = await db.collection("clients").findOne({ email: "referred@example.com" });
    expect(stored!.referredByStudentId).toBe(String(target));
  });
});

describe("M1.3 — client detail contract and PATCH integrity", () => {
  it("GET returns a full {client} envelope without PII; PII remains persisted", async () => {
    const id = await seedClient(undefined, "Detail Client", "detail@example.com", {
      dob: "1995-05-05", usiNumber: "USI-DETAIL", visaStatus: "Visitor",
    });
    const { GET } = await import("@/app/api/clients/[id]/route");
    const res = await GET(
      authedRequest("GET", `/api/clients/${id}`, undefined, makeSuperAdminToken()),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client.id).toBe(String(id));
    expect(body.client.legalName).toBe("Detail Client");
    expect(body.client.notes).toBe("");
    expectNoPii(body.client);
  });

  it("PATCH lowercases/dedupes email, validates, persists new fields, audits and ignores owner fields", async () => {
    const id = await seedClient(undefined, "Patch Client", "patch@example.com");
    const other = await seedClient(undefined, "Other", "other@example.com");

    const { PATCH } = await import("@/app/api/clients/[id]/route");
    const res = await PATCH(
      authedRequest("PATCH", `/api/clients/${id}`, {
        email: "  PATCH@EXAMPLE.COM ",
        phone: "0411 222 333",
        dob: "1990-02-02",
        usiNumber: "USI-PATCH",
        sourceAgentId: "agent-space-id",
        bdc_id: "should-be-ignored",
        b2b_agent_id: "should-be-ignored",
        contacts: [{ type: "phone", value: "0411 222 333", primary: true }],
      }, makeSuperAdminToken()),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client.email).toBe("patch@example.com");
    expect(body.client.phone).toBe("0411 222 333");
    expect(body.client.contacts).toHaveLength(1);
    expectNoPii(body.client);

    const db = await getDb();
    const stored = await db.collection("clients").findOne({ _id: id });
    expect(stored!.email).toBe("patch@example.com");
    expect(stored!.dob).toBe("1990-02-02");
    expect(stored!.usiNumber).toBe("USI-PATCH");
    expect(stored!.bdc_id).toBeUndefined();
    expect(stored!.b2b_agent_id).toBeUndefined();

    const dup = await PATCH(
      authedRequest("PATCH", `/api/clients/${id}`, { email: "OTHER@EXAMPLE.COM" }, makeSuperAdminToken()),
      { params: { id: String(id) } },
    );
    expect(dup.status).toBe(409);

    const audit = await db.collection("audit_logs").findOne({ entityType: "client", action: "update", entityId: String(id) });
    expect(audit).not.toBeNull();
    expect(other).toBeDefined();
  });

  it("malformed ids return 400 for GET and PATCH (no 500)", async () => {
    const { GET, PATCH } = await import("@/app/api/clients/[id]/route");
    const params = { params: { id: "not-an-object-id" } };
    const token = makeSuperAdminToken();
    expect((await GET(authedRequest("GET", "/api/clients/nope", undefined, token), params)).status).toBe(400);
    expect((await PATCH(authedRequest("PATCH", "/api/clients/nope", { legalName: "X" }, token), params)).status).toBe(400);
  });

  it("non-admin PATCH still rejects cross-account access on new-field updates", async () => {
    const other = await seedClient(undefined, "Other", "cross@example.com");
    await withOrder({ clientId: other, bdc_id: BDC_2, channel_type: "IN_HOUSE_B2C" });
    const { PATCH } = await import("@/app/api/clients/[id]/route");
    const res = await PATCH(
      authedRequest("PATCH", `/api/clients/${other}`, { usiNumber: "HACK" }, makeBDCToken(BDC_1)),
      { params: { id: String(other) } },
    );
    expect(res.status).toBe(403);
    const db = await getDb();
    const stored = await db.collection("clients").findOne({ _id: other });
    expect(stored!.usiNumber).toBeUndefined();
  });
});

describe("M1.3 — duplicates endpoint scoping and real phone values", () => {
  it("scopes duplicate groups to clients of owned orders (S10) and returns real phones", async () => {
    const a = await seedClient(undefined, "A", "shared@example.com", { phone: "0400 111 111" });
    const b = await seedClient(undefined, "B", "shared@example.com", { phone: "0400 111 111" });
    // A is owned by BDC_1; B is ownerless -> excluded from BDC's view.
    await withOrder({ clientId: a, bdc_id: BDC_1, channel_type: "B2C_BDC" });

    const { GET } = await import("@/app/api/clients/duplicates/route");

    const adminRes = await GET(authedRequest("GET", "/api/clients/duplicates", undefined, makeAdminToken()));
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.json();
    const adminEmailGroup = adminBody.certain.find((g: any) => g.key === "shared@example.com");
    expect(adminEmailGroup).toBeDefined();
    expect(adminEmailGroup.clients).toHaveLength(2);
    expect(adminEmailGroup.clients.every((c: any) => c.phone === "0400 111 111")).toBe(true);
    const adminPhoneGroup = adminBody.possible.find((g: any) => g.key === "0400111111");
    expect(adminPhoneGroup).toBeDefined();
    expect(adminPhoneGroup.clients).toHaveLength(2);

    const bdcRes = await GET(authedRequest("GET", "/api/clients/duplicates", undefined, makeBDCToken(BDC_1)));
    expect(bdcRes.status).toBe(200);
    const bdcBody = await bdcRes.json();
    expect(bdcBody.certain.some((g: any) => g.key === "shared@example.com")).toBe(false);
    expect(bdcBody.possible.some((g: any) => g.key === "0400111111")).toBe(false);
    expect(String(a)).not.toBe(String(b));
  });

  it("B2B_AGENT duplicate view is derived from its own agency's orders", async () => {
    const own = await seedClient(undefined, "Own", "b2b@example.com");
    const other = await seedClient(undefined, "Other", "b2b@example.com");
    await withOrder({ clientId: own, b2b_agent_id: "m13-b2b-1", channel_type: "B2B_AGENT" });
    const { GET } = await import("@/app/api/clients/duplicates/route");
    const res = await GET(authedRequest("GET", "/api/clients/duplicates", undefined, makeB2BAgentToken("m13-b2b-1")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.certain.some((g: any) => g.key === "b2b@example.com")).toBe(false);
    expect(String(own)).not.toBe(String(other));
  });
});
