import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getDb } from "@/lib/db";

import {
  exchangeCodeForTokens,
  refreshAccessToken,
  isQuickBooksConfigured,
} from "@/lib/quickbooks";

// Save original env.
const origEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...origEnv };
  delete process.env.QB_ENCRYPTION_KEY;
  delete process.env.QB_CLIENT_ID;
  delete process.env.QB_CLIENT_SECRET;
});

afterEach(() => {
  process.env = { ...origEnv };
  vi.restoreAllMocks();
});

describe("Phase 6 — QuickBooks encryption fail-closed", () => {
  it("exchangeCodeForTokens fails closed without QB_ENCRYPTION_KEY", async () => {
    process.env.QB_CLIENT_ID = "client-id";
    process.env.QB_CLIENT_SECRET = "client-secret";
    // No QB_ENCRYPTION_KEY set.

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token-abc",
          refresh_token: "refresh-token-xyz",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as any;

    const result = await exchangeCodeForTokens("auth-code", "realm-123");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("encryption is not configured");

    fetchSpy.mockRestore();
  });

  it("exchangeCodeForTokens succeeds with valid encryption key", async () => {
    process.env.QB_CLIENT_ID = "client-id";
    process.env.QB_CLIENT_SECRET = "client-secret";
    process.env.QB_ENCRYPTION_KEY = "test-encryption-key-32-chars!!";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token-abc",
          refresh_token: "refresh-token-xyz",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as any;

    const result = await exchangeCodeForTokens("auth-code", "realm-123");
    expect(result.ok).toBe(true);
    expect(result.realmId).toBe("realm-123");

    fetchSpy.mockRestore();
  });

  it("API responses do not expose raw tokens", async () => {
    process.env.QB_CLIENT_ID = "client-id";
    process.env.QB_CLIENT_SECRET = "client-secret";
    process.env.QB_ENCRYPTION_KEY = "test-encryption-key-32-chars!!";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token-abc",
          refresh_token: "refresh-token-xyz",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as any;

    const result = await exchangeCodeForTokens("auth-code", "realm-123");
    expect(result.ok).toBe(true);
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("access-token-abc");
    expect(resultStr).not.toContain("refresh-token-xyz");

    fetchSpy.mockRestore();
  });

  it("refreshAccessToken fails closed without encryption key", async () => {
    process.env.QB_CLIENT_ID = "client-id";
    process.env.QB_CLIENT_SECRET = "client-secret";
    // No QB_ENCRYPTION_KEY set.

    const db = await getDb();
    await db.collection("qb_connections").insertOne({
      realmId: "realm-123",
      accessTokenEncrypted: JSON.stringify({
        iv: "x",
        authTag: "x",
        ciphertext: "x",
      }),
      refreshTokenEncrypted: JSON.stringify({
        iv: "x",
        authTag: "x",
        ciphertext: "x",
      }),
      connectionStatus: "connected",
      updatedAt: new Date(),
    });

    const result = await refreshAccessToken();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("decrypt");

    await db.collection("qb_connections").deleteMany({});
  });

  it("isQuickBooksConfigured reports client credentials only", () => {
    process.env.QB_CLIENT_ID = "client-id";
    process.env.QB_CLIENT_SECRET = "client-secret";
    expect(isQuickBooksConfigured()).toBe(true);

    delete process.env.QB_CLIENT_SECRET;
    expect(isQuickBooksConfigured()).toBe(false);
  });

  it("exchangeCodeForTokens fails when QB client credentials missing", async () => {
    // No QB_CLIENT_ID / QB_CLIENT_SECRET set.
    const result = await exchangeCodeForTokens("auth-code", "realm-123");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not configured");
  });
});
