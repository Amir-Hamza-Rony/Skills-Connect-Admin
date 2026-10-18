import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { RefreshToken } from "../src/models/refresh-token.model.js";
import { User } from "../src/models/user.model.js";
import { createUser, seedRoles, setupTestDatabase } from "./helpers/test-db.js";

/**
 * User administration, the audit trail's append-only guarantee, and the
 * permission matrix the SPA consumes.
 */
setupTestDatabase();

const PASSWORD = "CorrectHorseBattery1!";
let app: ReturnType<typeof createApp>;
let adminToken: string;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await seedRoles();
});

async function signIn(email = "admin@example.com"): Promise<string> {
  await createUser({ email, password: PASSWORD, roleNames: ["Super Admin"] });
  const res = await request(app).post("/auth/login").send({ email, password: PASSWORD });
  return res.body.accessToken as string;
}

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

describe("GET /users", () => {
  it("returns users with role names and no secrets", async () => {
    adminToken = await signIn();
    await createUser({ email: "sales@example.com", roleNames: ["Sales / Closing Agent"] });

    const res = await request(app).get("/users").set(authed(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    const row = res.body.users.find((u: { email: string }) => u.email === "sales@example.com");
    expect(row.roleNames).toEqual(["Sales / Closing Agent"]);
    expect(row.passwordHash).toBeUndefined();
    expect(row.failedLoginCount).toBeUndefined();
  });

  it("supports a search filter", async () => {
    adminToken = await signIn();
    await createUser({ email: "someone@else.com", roleNames: ["Finance"] });

    const res = await request(app).get("/users?search=someone").set(authed(adminToken));
    expect(res.body.users).toHaveLength(1);
  });
});

describe("POST /users", () => {
  it("creates a user with a hashed password", async () => {
    adminToken = await signIn();

    const res = await request(app)
      .post("/users")
      .set(authed(adminToken))
      .send({
        email: "new@example.com",
        name: "New Person",
        password: PASSWORD,
        roleNames: ["Operations"],
      });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("new@example.com");

    const stored = await User.findOne({ email: "new@example.com" }).select("+passwordHash");
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored!.passwordHash).not.toContain(PASSWORD);
  });

  it("rejects a duplicate email", async () => {
    adminToken = await signIn();
    await createUser({ email: "dupe@example.com", roleNames: ["Finance"] });

    const res = await request(app)
      .post("/users")
      .set(authed(adminToken))
      .send({ email: "dupe@example.com", name: "D", password: PASSWORD, roleNames: ["Finance"] });

    expect(res.status).toBe(409);
  });

  it("rejects a short password", async () => {
    adminToken = await signIn();
    const res = await request(app)
      .post("/users")
      .set(authed(adminToken))
      .send({ email: "x@example.com", name: "X", password: "short", roleNames: ["Finance"] });

    expect(res.status).toBe(400);
  });

  it("rejects an unknown role", async () => {
    adminToken = await signIn();
    const res = await request(app)
      .post("/users")
      .set(authed(adminToken))
      .send({ email: "x@example.com", name: "X", password: PASSWORD, roleNames: ["Wizard"] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNKNOWN_ROLE");
  });
});

describe("PATCH /users/:id", () => {
  it("updates roles and records before -> after", async () => {
    adminToken = await signIn();
    const target = await createUser({ email: "s@example.com", roleNames: ["Sales / Closing Agent"] });

    const res = await request(app)
      .patch(`/users/${target.id}`)
      .set(authed(adminToken))
      .send({ roleNames: ["Operations"] });

    expect(res.status).toBe(200);
    expect(res.body.user.roleNames).toEqual(["Operations"]);

    const entry = await AuditLog.findOne({ action: "user.update" }).lean();
    expect(entry?.before).toMatchObject({ roleNames: ["Sales / Closing Agent"] });
    expect(entry?.after).toMatchObject({ roleNames: ["Operations"] });
    expect(entry?.actorId).toBeTruthy();
    expect(entry?.ip).toBeDefined();
  });

  it("revokes sessions when an account is deactivated", async () => {
    adminToken = await signIn();
    const target = await createUser({ email: "s@example.com", roleNames: ["Finance"] });

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "s@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBeGreaterThan(0);

    await request(app).patch(`/users/${target.id}`).set(authed(adminToken)).send({ active: false });

    expect(await RefreshToken.countDocuments({ revokedAt: null, userId: target.id })).toBe(0);
  });

  it("refuses to demote the last active Super Admin", async () => {
    adminToken = await signIn();
    const me = await User.findOne({ email: "admin@example.com" });

    const res = await request(app)
      .patch(`/users/${me!.id}`)
      .set(authed(adminToken))
      .send({ roleNames: ["Read Only / Manager"] });

    expect(res.status).toBe(409);
  });
});

describe("POST /users/:id/reset-password", () => {
  it("changes the password and kills every session", async () => {
    adminToken = await signIn();
    const target = await createUser({ email: "s@example.com", roleNames: ["Finance"] });

    await request(app).post("/auth/login").send({ email: "s@example.com", password: PASSWORD });

    const res = await request(app)
      .post(`/users/${target.id}/reset-password`)
      .set(authed(adminToken))
      .send({ password: "BrandNewPassword9!" });

    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBeGreaterThan(0);

    const old = await request(app)
      .post("/auth/login")
      .send({ email: "s@example.com", password: PASSWORD });
    expect(old.status).toBe(401);

    const fresh = await request(app)
      .post("/auth/login")
      .send({ email: "s@example.com", password: "BrandNewPassword9!" });
    expect(fresh.status).toBe(200);
  });

  it("invalidates an already-issued access token", async () => {
    adminToken = await signIn();
    const target = await createUser({ email: "s@example.com", roleNames: ["Finance"] });
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "s@example.com", password: PASSWORD });
    const salesToken = login.body.accessToken as string;

    expect((await request(app).get("/auth/me").set(authed(salesToken))).status).toBe(200);

    await request(app)
      .post(`/users/${target.id}/reset-password`)
      .set(authed(adminToken))
      .send({ password: "BrandNewPassword9!" });

    expect((await request(app).get("/auth/me").set(authed(salesToken))).status).toBe(401);
  });

  it("invalidates a token in the same second the password was reset", async () => {
    // Regression guard: comparing `passwordChangedAt` against the JWT `iat`
    // would have failed here, because `iat` only has second resolution.
    adminToken = await signIn();
    const target = await createUser({ email: "s@example.com", roleNames: ["Finance"] });
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "s@example.com", password: PASSWORD });

    const res = await request(app)
      .post(`/users/${target.id}/reset-password`)
      .set(authed(adminToken))
      .send({ password: "BrandNewPassword9!" });

    expect(res.status).toBe(200);
    expect((await request(app).get("/auth/me").set(authed(login.body.accessToken))).status).toBe(401);
  });
});

describe("POST /users/:id/unlock", () => {
  it("clears a lockout", async () => {
    adminToken = await signIn();
    const target = await createUser({ email: "s@example.com", roleNames: ["Finance"] });

    await User.updateOne(
      { email: "s@example.com" },
      { $set: { failedLoginCount: 9, lockedUntil: new Date(Date.now() + 600_000) } },
    );

    const res = await request(app).post(`/users/${target.id}/unlock`).set(authed(adminToken));
    expect(res.status).toBe(200);

    const stored = await User.findOne({ email: "s@example.com" }).select("+failedLoginCount +lockedUntil");
    expect(stored!.failedLoginCount).toBe(0);
    expect(stored!.lockedUntil).toBeNull();
  });
});

describe("roles + permission matrix", () => {
  it("returns the seven seeded roles with permissions", async () => {
    adminToken = await signIn();
    const res = await request(app).get("/roles").set(authed(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.roles).toHaveLength(7);
    const superAdmin = res.body.roles.find((r: { name: string }) => r.name === "Super Admin");
    expect(superAdmin.permissions).toHaveLength(18);
  });

  it("serves the matrix from the server, not a frontend copy", async () => {
    adminToken = await signIn();
    const res = await request(app).get("/auth/permissions").set(authed(adminToken));
    expect(res.body.permissions).toHaveLength(18);
    expect(res.body.permissions).toContain("qb.retry");
  });
});

describe("GET /users/directory", () => {
  it("returns id + name only, with no email, phone, roles or lockout state", async () => {
    adminToken = await signIn();
    await createUser({ email: "staff@example.com", name: "Staff Person", roleNames: ["Finance"] });

    const res = await request(app).get("/users/directory").set(authed(adminToken));

    expect(res.status).toBe(200);
    const row = res.body.users.find((u: { name: string }) => u.name === "Staff Person");
    expect(row).toBeDefined();
    expect(Object.keys(row).sort()).toEqual(["id", "name"]);
  });

  it("is readable by a role WITHOUT users.manage", async () => {
    // Every screen that resolves an actor id to a name (tasks, documents,
    // audit, timelines) is visible to roles that cannot administer users.
    await createUser({ email: "sales@example.com", roleNames: ["Sales / Closing Agent"] });
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "sales@example.com", password: PASSWORD });
    const salesToken = login.body.accessToken as string;

    const res = await request(app).get("/users/directory").set(authed(salesToken));

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
  });

  it("still requires authentication", async () => {
    const res = await request(app).get("/users/directory");
    expect(res.status).toBe(401);
  });

  it("does NOT widen access to the admin list", async () => {
    await createUser({ email: "sales@example.com", roleNames: ["Sales / Closing Agent"] });
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "sales@example.com", password: PASSWORD });
    const salesToken = login.body.accessToken as string;

    expect((await request(app).get("/users").set(authed(salesToken))).status).toBe(403);
  });
});

describe("audit log is append-only", () => {
  it("blocks deleteMany", async () => {
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it("blocks updateMany", async () => {
    await expect(AuditLog.updateMany({}, { $set: { action: "tampered" } })).rejects.toThrow(
      /append-only/,
    );
  });

  it("blocks findOneAndUpdate", async () => {
    await expect(
      AuditLog.findOneAndUpdate({ action: "auth.login.success" }, { $set: { action: "x" } }),
    ).rejects.toThrow(/append-only/);
  });
});

describe("audit scrubbing", () => {
  it("never stores a password even if a caller passes one", async () => {
    adminToken = await signIn();
    await createUser({ email: "s@example.com", roleNames: ["Finance"] });

    await request(app)
      .post("/users")
      .set(authed(adminToken))
      .send({
        email: "n@example.com",
        name: "N",
        password: PASSWORD,
        roleNames: ["Finance"],
      });

    const all = await AuditLog.find({}).lean();
    expect(JSON.stringify(all)).not.toContain(PASSWORD);
    expect(JSON.stringify(all)).not.toContain("$argon2");
  });
});