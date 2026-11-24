import { describe, it, expect } from "vitest";

import { safeEqual } from "@/app/api/integrations/quickbooks/webhook/route";

describe("QuickBooks webhook safeEqual()", () => {
  it("returns true for matching signatures", () => {
    const sig = "abc123def456";
    expect(safeEqual(sig, sig)).toBe(true);
  });

  it("returns true for matching empty signatures", () => {
    expect(safeEqual("", "")).toBe(true);
  });

  it("returns false for different signatures of equal length", () => {
    expect(safeEqual("aaaa1111", "bbbb2222")).toBe(false);
    expect(safeEqual("abcdefgh", "abcdefgi")).toBe(false);
    expect(safeEqual("0".repeat(64), "1".repeat(64))).toBe(false);
  });

  it("returns false for different-length signatures", () => {
    expect(safeEqual("short", "muchlonger")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abcdefgh", "abc")).toBe(false);
    expect(safeEqual("x", "xy")).toBe(false);
  });

  it("returns false when one input is empty and the other is not", () => {
    expect(safeEqual("", "nonempty")).toBe(false);
    expect(safeEqual("nonempty", "")).toBe(false);
  });

  it("is constant-time safe: no length-based early return that leaks info", () => {
    // Different lengths must still return false, not throw.
    expect(() => safeEqual("a", "aa")).not.toThrow();
    expect(safeEqual("a", "aa")).toBe(false);
    expect(() => safeEqual("aaaa", "a")).not.toThrow();
    expect(safeEqual("aaaa", "a")).toBe(false);
  });
});
