import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The env module throws at import time, so each case needs a fresh module graph
 * and a controlled `process.env`. Tests stub the variables they care about so
 * they stay deterministic even when a developer has a real `server/.env`.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Blanks a set of keys so their schema defaults apply. */
function blank(...keys: string[]): void {
  for (const key of keys) vi.stubEnv(key, "");
}

describe("env validation", () => {
  it("refuses to boot when MONGODB_URI is missing", async () => {
    vi.stubEnv("MONGODB_URI", "");
    vi.resetModules();

    await expect(import("../src/config/env.js")).rejects.toThrow(/MONGODB_URI is required/);
  });

  it("names the .env.example file in the failure message", async () => {
    vi.stubEnv("MONGODB_URI", "");
    vi.resetModules();

    await expect(import("../src/config/env.js")).rejects.toThrow(/\.env\.example/);
  });

  it("applies documented defaults for blank values", async () => {
    blank("PORT", "HOST", "LOG_LEVEL", "MONGODB_DB", "REDIS_URL");
    vi.stubEnv("MONGODB_URI", "mongodb+srv://user:pass@example.invalid/db");
    vi.resetModules();

    const { env } = await import("../src/config/env.js");

    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.MONGODB_DB).toBe("skills_connect_admin");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
  });

  it("treats a blank PORT as unset instead of coercing it to 0", async () => {
    vi.stubEnv("PORT", "");
    vi.stubEnv("MONGODB_URI", "mongodb+srv://example.invalid/db");
    vi.resetModules();

    const { env } = await import("../src/config/env.js");

    expect(env.PORT).toBe(4000);
  });

  it("parses a comma-separated CORS allowlist", async () => {
    vi.stubEnv("CORS_ORIGINS", "https://a.example.com, https://b.example.com ,");
    vi.stubEnv("MONGODB_URI", "mongodb+srv://example.invalid/db");
    vi.resetModules();

    const { env } = await import("../src/config/env.js");

    expect(env.CORS_ORIGINS).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("coerces PORT from a string and rejects an out-of-range port", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb+srv://example.invalid/db");

    vi.stubEnv("PORT", "8080");
    vi.resetModules();
    await expect(import("../src/config/env.js")).resolves.toBeDefined();

    vi.stubEnv("PORT", "70000");
    vi.resetModules();
    await expect(import("../src/config/env.js")).rejects.toThrow();
  });

});