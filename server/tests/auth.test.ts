import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { User } from "../src/models/user.model.js";
import { RefreshToken } from "../src/models/refresh-token.model.js";
import {
  clearTestDb,
  CookieJar,
  createUser,
  seedRoles,
  setupTestDatabase,
} from "./helpers/test-db.js";

/**
 * B2 acceptance criteria, run against a real MongoDB with the real models.
 * Covers: wrong password rejected · refresh rotation · reuse detection ·
 * Sales user gets 403 on /users.
 */
setupTestDatabase();

const PASSWORD = "CorrectHorseBattery1!";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await clearTestDb();
  await seedRoles();
});

async function loginAs(
  email: string,
  password = PASSWORD,
  roleNames: string[] = ["Super Admin"],
): Promise<{ jar: CookieJar; accessToken: string }> {
  await createUser({ email, password, roleNames });
  const res = await request(app).post("/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return { jar: new CookieJar().capture(res), accessToken: res.body.accessToken as string };
}

/* ============================ login ============================ */

describe("POST /auth/login", () => {
  it("issues an access token and an httpOnly refresh cookie", async () => {
    await createUser({ email: "admin@example.com", password: PASSWORD });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.tokenType).toBe("Bearer");
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.user.email).toBe("admin@example.com");
    expect(res.body.user.permissions).toContain("users.manage");

    const cookies = res.headers["set-cookie"] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith("sc_refresh="));
    expect(refresh).toBeDefined();
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("Path=/auth");
  });

  it("never returns the password hash", async () => {
    await createUser({ email: "admin@example.com", password: PASSWORD });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: PASSWORD });

    expect(JSON.stringify(res.body)).not.toContain("$argon2");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("REJECTS a wrong password", async () => {
    await createUser({ email: "admin@example.com", password: PASSWORD });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "WrongPassword123!" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects an unknown account with the same message as a bad password", async () => {
    await createUser({ email: "admin@example.com", password: PASSWORD });
    const unknown = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "WrongPassword123!" });
    const wrong = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "WrongPassword123!" });

    // Identical wording prevents account enumeration.
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it("is case-insensitive on email and records lastLoginAt", async () => {
    await createUser({ email: "admin@example.com", password: PASSWORD });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "  ADMIN@Example.COM  ", password: PASSWORD });

    expect(res.status).toBe(200);
    const stored = await User.findOne({ email: "admin@example.com" });
    expect(stored?.lastLoginAt).toBeInstanceOf(Date);
  });

  it("refuses a deactivated account", async () => {
    await createUser({ email: "off@example.com", password: PASSWORD, active: false });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "off@example.com", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("validates the request body", async () => {
    const res = await request(app).post("/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rate-limits repeated failures from one IP+email", async () => {
    await createUser({ email: "admin@example.com", password: PASSWORD });
    const seen = new Set<number>();
    let retryAfter: string | undefined;

    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "admin@example.com", password: `wrong-${i}` });
      seen.add(res.status);
      if (res.status === 429) retryAfter = res.headers["retry-after"];
    }

    // The limiter must actually REFUSE, not merely count. It used to set the
    // headers and call next() regardless, so the test below asserted only that
    // nothing 500'd — which passed while proving nothing about limiting at all.
    expect(seen.has(429)).toBe(true);
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);

    // And the limiter names itself rather than returning a bare status.
    const blocked = await request(app)
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "wrong-again" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });

  it("does not rate-limit a different email from the same IP", async () => {
    await createUser({ email: "first@example.com", password: PASSWORD });
    for (let i = 0; i < 7; i += 1) {
      await request(app)
        .post("/auth/login")
        .send({ email: "first@example.com", password: "wrong" });
    }
    const blocked = await request(app)
      .post("/auth/login")
      .send({ email: "first@example.com", password: "wrong" });
    expect(blocked.status).toBe(429);

    // The key is IP+email, so hammering one address must not lock out a
    // colleague behind the same NAT.
    await createUser({ email: "colleague@example.com", password: PASSWORD });
    const other = await request(app)
      .post("/auth/login")
      .send({ email: "colleague@example.com", password: PASSWORD });
    expect(other.status).toBe(200);
  });
});

/* ==================== refresh rotation ==================== */

describe("POST /auth/refresh — rotation", () => {
  it("returns a NEW refresh cookie and a new access token", async () => {
    const { jar } = await loginAs("admin@example.com");
    const before = jar.get("sc_refresh");

    const res = await request(app)
      .post("/auth/refresh")
      .set("Cookie", jar.header());

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");

    const jar2 = new CookieJar().capture(res);
    expect(jar2.get("sc_refresh")).toBeDefined();
    expect(jar2.get("sc_refresh")).not.toBe(before);
  });

  it("keeps the successor in the same family", async () => {
    const { jar } = await loginAs("admin@example.com");
    await request(app).post("/auth/refresh").set("Cookie", jar.header());

    const tokens = await RefreshToken.find({}).lean();
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.familyId).toBe(tokens[1]?.familyId);
    expect(tokens.filter((t) => t.usedAt !== null)).toHaveLength(1);
  });

  it("rejects a request with no cookie", async () => {
    const res = await request(app).post("/auth/refresh");
    expect(res.status).toBe(401);
  });
});

/* ==================== reuse detection ==================== */

describe("POST /auth/refresh — reuse detection", () => {
  it("revokes the WHOLE family when a used token is replayed", async () => {
    const { jar } = await loginAs("admin@example.com");
    const stolen = jar.get("sc_refresh")!;

    // Legitimate rotation.
    const first = await request(app).post("/auth/refresh").set("Cookie", jar.header());
    expect(first.status).toBe(200);
    const jar2 = new CookieJar().capture(first);

    // Attacker replays the already-used original.
    const replay = await request(app)
      .post("/auth/refresh")
      .set("Cookie", `sc_refresh=${stolen}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("REFRESH_REUSE_DETECTED");

    // The legitimate holder is locked out too — the safe outcome.
    const after = await request(app).post("/auth/refresh").set("Cookie", jar2.header());
    expect(after.status).toBe(401);
  });

  it("leaves no live token in the family after detection", async () => {
    const { jar } = await loginAs("admin@example.com");
    const stolen = jar.get("sc_refresh")!;

    await request(app).post("/auth/refresh").set("Cookie", jar.header());
    await request(app).post("/auth/refresh").set("Cookie", `sc_refresh=${stolen}`);

    const live = await RefreshToken.countDocuments({ revokedAt: null });
    expect(live).toBe(0);
  });

  it("stores only a hash of the refresh token", async () => {
    const { jar } = await loginAs("admin@example.com");
    const raw = jar.get("sc_refresh")!;

    const record = await RefreshToken.findOne({ userId: (await User.findOne())!.id });
    expect(record?.tokenHash).not.toBe(raw);
    expect(record?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

/* ============================ logout ============================ */

describe("POST /auth/logout", () => {
  it("revokes the family and clears the cookie", async () => {
    const { jar } = await loginAs("admin@example.com");

    const res = await request(app).post("/auth/logout").set("Cookie", jar.header());
    expect(res.status).toBe(204);

    const cookies = res.headers["set-cookie"] as unknown as string[];
    // Express clears a cookie by emptying the value and back-dating `Expires`
    // (it does not emit Max-Age=0), so assert on that shape.
    const cleared = cookies.find((c) => c.startsWith("sc_refresh="));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/sc_refresh=;/);
    expect(cleared).toMatch(/expires=Thu, 01 Jan 1970|max-age=0/i);
    expect(cleared).toContain("HttpOnly");

    const after = await request(app).post("/auth/refresh").set("Cookie", jar.header());
    expect(after.status).toBe(401);
  });
});

/* ==================== requireAuth ==================== */

describe("requireAuth", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed token", async () => {
    const res = await request(app).get("/auth/me").set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bogus");
    expect(res.status).toBe(401);
  });

  it("returns the current principal", async () => {
    const { accessToken } = await loginAs("admin@example.com");
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("admin@example.com");
    expect(res.body.user.permissions).toContain("settings.manage");
  });

  it("blocks a token minted before the token version was bumped", async () => {
    const { accessToken } = await loginAs("admin@example.com");

    // `tokenVersion` is the invalidation mechanism (not `passwordChangedAt`):
    // a JWT `iat` only has second resolution, so a timestamp comparison cannot
    // reliably catch a reset in the same second.
    const user = await User.findOne({ email: "admin@example.com" });
    user!.tokenVersion += 1;
    await user!.save();

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });

  it("blocks a deactivated account immediately", async () => {
    const { accessToken } = await loginAs("admin@example.com");
    await User.updateOne({ email: "admin@example.com" }, { $set: { active: false } });

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });
});

/* ==================== RBAC — the 403 criterion ==================== */

describe("requirePermission", () => {
  it("gives a SALES user 403 on /users", async () => {
    const { accessToken } = await loginAs("sales@example.com", PASSWORD, ["Sales / Closing Agent"]);

    const res = await request(app).get("/users").set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toContain("users.manage");
  });

  it("gives a Sales user 403 on /roles", async () => {
    const { accessToken } = await loginAs("sales@example.com", PASSWORD, ["Sales / Closing Agent"]);
    const res = await request(app).get("/roles").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it("lets Super Admin through", async () => {
    const { accessToken } = await loginAs("admin@example.com");
    const res = await request(app).get("/users").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it("lets Finance read users away but not manage them", async () => {
    const { accessToken } = await loginAs("fin@example.com", PASSWORD, ["Finance"]);
    const res = await request(app).get("/users").set("Authorization", `Bearer ${accessToken}`);
    // Finance lacks users.manage, so the guard must still deny.
    expect(res.status).toBe(403);
  });

  it("records a denied attempt in the audit log", async () => {
    const { AuditLog } = await import("../src/models/audit-log.model.js");
    const { accessToken } = await loginAs("sales@example.com", PASSWORD, ["Sales / Closing Agent"]);

    await request(app).get("/users").set("Authorization", `Bearer ${accessToken}`);

    const events = await AuditLog.find({ action: "permission.denied" }).lean();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.entityId).toContain("/users");
  });

  it("requires authentication BEFORE permission", async () => {
    const res = await request(app).get("/users");
    expect(res.status).toBe(401); // not 403
  });
});