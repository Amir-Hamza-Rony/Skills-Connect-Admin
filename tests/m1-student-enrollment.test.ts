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
import { clearDb, seedClient, seedOrder } from "./helpers";

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
  it("still exposes exactly the 21 approved statuses", () => {
    const expected = [
      "Lead", "Qualified", "Won", "Lost", "New", "Awaiting Payment",
      "Awaiting Documents", "Documents Under Review", "Ready for Submission",
      "Submitted to Source Agent", "Submitted to RTO", "RTO Acknowledged",
      "Under Assessment", "Additional Evidence Required", "Rework Required",
      "Approved", "Certificate Issued", "Completed", "On Hold", "Cancelled", "Refunded",
    ];
    const actual = ORDER_STATUS_GROUPS.flatMap((group) => group.statuses);
    expect(new Set(actual).size).toBe(21);
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});
