/**
 * Live end-to-end smoke test against the running API + real Atlas database.
 * Verifies the B2 acceptance criteria over HTTP, not in-process.
 *
 * Usage: node scripts/smoke.mjs   (server must already be running on :4000)
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:4000";
const ADMIN = process.env.SEED_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;

if (!ADMIN || !PASSWORD) {
  console.error(
    "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not found in server/.env.\n" +
      "Run `npm run server:seed` first, and start the server before this script.",
  );
  process.exit(1);
}

let pass = 0;
let fail = 0;

function check(label, condition, extra = "") {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} ${extra}`);
  }
}

/** Minimal cookie jar so the refresh rotation chain can be replayed. */
class Jar {
  constructor(entries = []) {
    this.jar = new Map(entries);
  }
  capture(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), decodeURIComponent(pair.slice(i + 1)));
    }
    return this;
  }
  header() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get(k) {
    return this.jar.get(k);
  }
  /** Convenience for "replay this one cookie", which is what the reuse test needs. */
  static with(name, value) {
    return new Jar([[name, value]]);
  }
}

async function call(path, { method = "GET", body, token, jar } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (jar) headers.Cookie = jar.header();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. 204) */
  }
  return { status: res.status, json, res };
}

/**
 * Makes the script re-runnable. There is no DELETE endpoint by design (nothing
 * is ever deleted — only voided/revoked), so an existing smoke user is revived
 * and re-keyed through the admin API instead of being recreated.
 */
async function ensureUser(adminToken, { email, name, password, roleNames }) {
  const list = await call("/users?search=" + encodeURIComponent(email), { token: adminToken });
  const existing = list.json?.users?.find((u) => u.email === email);

  if (existing) {
    await call(`/users/${existing.id}/reset-password`, {
      method: "POST",
      token: adminToken,
      body: { password },
    });
    await call(`/users/${existing.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { active: true, name },
    });
    return existing.id;
  }

  const created = await call("/users", {
    method: "POST",
    token: adminToken,
    body: { email, name, password, roleNames },
  });
  if (created.status !== 201) {
    throw new Error(`ensureUser failed for ${email}: ${created.status} ${JSON.stringify(created.json?.error ?? {})}`);
  }
  return created.json.user.id;
}

console.log(`\nSkills Connect Admin — B2 live smoke test\n${BASE}\n`);

// ---------------------------------------------------------------- health
console.log("health");
{
  const { status, json } = await call("/health");
  check("GET /health is 200", status === 200);
  check("database is connected", json?.db === "connected", `db=${json?.db}`);
  const ready = await call("/health/ready");
  check("GET /health/ready is 200", ready.status === 200);
}

// ---------------------------------------------------------------- login
console.log("\nlogin");
let adminToken;
let adminJar;
{
  const bad = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: "WrongPassword123!" } });
  check("wrong password is rejected (401)", bad.status === 401);
  check("no cookie issued on failure", !(bad.res.headers.getSetCookie?.() ?? []).length);

  const ok = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  check("correct password is accepted (200)", ok.status === 200, `got ${ok.status}`);
  check("access token returned", typeof ok.json?.accessToken === "string");
  check("permissions returned", Array.isArray(ok.json?.user?.permissions));
  check("argon2 hash never returned", !JSON.stringify(ok.json ?? {}).includes("$argon2"));

  adminToken = ok.json?.accessToken;
  adminJar = new Jar().capture(ok.res);
  check("refresh cookie set", Boolean(adminJar.get("sc_refresh")));
}

// ---------------------------------------------------- requireAuth / me
console.log("\nauthenticated session");
{
  const noAuth = await call("/auth/me");
  check("no token is 401", noAuth.status === 401);

  const me = await call("/auth/me", { token: adminToken });
  check("valid token returns the principal", me.status === 200, `got ${me.status}`);
  check("principal email matches", me.json?.user?.email === ADMIN);
  check("Super Admin has users.manage", me.json?.user?.permissions?.includes("users.manage"));
  check("Super Admin has 18 permissions", me.json?.user?.permissions?.length === 18);
}

// -------------------------------------------------------- rotation
console.log("\nrefresh rotation");
let rotatedJar;
let stolen;
{
  stolen = adminJar.get("sc_refresh");

  const r1 = await call("/auth/refresh", { method: "POST", jar: adminJar });
  check("refresh returns 200", r1.status === 200, `got ${r1.status}`);
  rotatedJar = new Jar().capture(r1.res);
  check("a new refresh cookie is issued", Boolean(rotatedJar.get("sc_refresh")));
  check("the cookie actually rotated", rotatedJar.get("sc_refresh") !== stolen);
}

// ------------------------------------------------------ reuse detection
console.log("\nreuse detection");
{
  const replay = await call("/auth/refresh", { method: "POST", jar: Jar.with("sc_refresh", stolen) });
  check("replaying a used token is 401", replay.status === 401, `got ${replay.status}`);
  check("error names the reuse", replay.json?.error?.code === "REFRESH_REUSE_DETECTED", replay.json?.error?.code);

  const legit = await call("/auth/refresh", { method: "POST", jar: rotatedJar });
  check("the whole family is revoked", legit.status === 401, `got ${legit.status}`);
}

// ----------------------------------------------------------- logout
console.log("\nlogout");
{
  const fresh = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const jar = new Jar().capture(fresh.res);

  const out = await call("/auth/logout", { method: "POST", jar });
  check("logout returns 204", out.status === 204, `got ${out.status}`);

  const after = await call("/auth/refresh", { method: "POST", jar });
  check("session is dead after logout", after.status === 401, `got ${after.status}`);
}

// --------------------------------------------------- RBAC: create a Sales user
console.log("\nRBAC");
{
  const login = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const admin = login.json.accessToken;

  const email = "smoke-sales@example.com";
  const salesPassword = "SmokeSalesPass123!";
  const created = await call("/users", {
    method: "POST",
    token: admin,
    body: { email, name: "Smoke Sales", password: salesPassword, roleNames: ["Sales / Closing Agent"] },
  });
  const alreadyExisted = created.status === 409;
  if (alreadyExisted) {
    await ensureUser(admin, {
      email,
      name: "Smoke Sales",
      password: salesPassword,
      roleNames: ["Sales / Closing Agent"],
    });
  }
  check("admin can create a user (or it already exists)", created.status === 201 || alreadyExisted, `got ${created.status}`);

  const salesLogin = await call("/auth/login", { method: "POST", body: { email, password: salesPassword } });
  check("sales user can sign in", salesLogin.status === 200, `got ${salesLogin.status} ${JSON.stringify(salesLogin.json?.error ?? {})}`);

  const sales = salesLogin.json.accessToken;
  const salesPerms = salesLogin.json.user.permissions;

  check("sales has NO users.manage", !salesPerms.includes("users.manage"));
  check("sales CAN view clients", salesPerms.includes("clients.view"));

  const forbidden = await call("/users", { token: sales });
  check("SALES GET /users -> 403", forbidden.status === 403, `got ${forbidden.status}`);
  check("403 names the missing permission", forbidden.json?.error?.message?.includes("users.manage"));

  const forbiddenRoles = await call("/roles", { token: sales });
  check("SALES GET /roles -> 403", forbiddenRoles.status === 403, `got ${forbiddenRoles.status}`);

  const allowed = await call("/auth/me", { token: sales });
  check("SALES GET /auth/me -> 200", allowed.status === 200);

  const anon = await call("/users");
  check("anonymous /users -> 401 not 403", anon.status === 401, `got ${anon.status}`);

  // deactivate -> sessions must die immediately
  const list = await call("/users?search=smoke-sales", { token: admin });
  const salesId = list.json?.users?.[0]?.id;
  if (salesId) {
    const before = await call("/auth/me", { token: sales });
    check("sales token works before deactivation", before.status === 200);

    const off = await call(`/users/${salesId}`, { method: "PATCH", token: admin, body: { active: false } });
    check("deactivation succeeds", off.status === 200, `got ${off.status}`);

    const after = await call("/auth/me", { token: sales });
    check("deactivated account loses access immediately", after.status === 401, `got ${after.status}`);

    const relogin = await call("/auth/login", { method: "POST", body: { email, password: "SmokeSalesPass123!" } });
    check("deactivated account cannot sign in", relogin.status === 403, `got ${relogin.status}`);
  }
}

// ---------------------------------------------------------- password reset
console.log("\npassword reset invalidates live tokens");
{
  const adminLogin = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const admin = adminLogin.json.accessToken;

  const email = "smoke-reset@example.com";
  const oldPassword = "SmokeResetPass123!";
  const newPassword = "SmokeResetNewPass456!";
  await ensureUser(admin, {
    email,
    name: "Smoke Reset",
    password: oldPassword,
    roleNames: ["Read Only / Manager"],
  });
  const login = await call("/auth/login", { method: "POST", body: { email, password: oldPassword } });
  const victimToken = login.json.accessToken;

  const list = await call("/users?search=smoke-reset", { token: admin });
  const id = list.json?.users?.[0]?.id;
  check("reset target found", Boolean(id));

  const reset = await call(`/users/${id}/reset-password`, {
    method: "POST",
    token: admin,
    body: { password: newPassword },
  });
  check("reset succeeds", reset.status === 200, `got ${reset.status}`);
  check("sessions were revoked", reset.json?.revokedSessions >= 1);

  const after = await call("/auth/me", { token: victimToken });
  check("old access token is now 401", after.status === 401, `got ${after.status}`);

  const oldPw = await call("/auth/login", { method: "POST", body: { email, password: oldPassword } });
  check("old password is rejected", oldPw.status === 401, `got ${oldPw.status}`);

  const newPw = await call("/auth/login", { method: "POST", body: { email, password: newPassword } });
  check("new password works", newPw.status === 200, `got ${newPw.status}`);

  // Leave the fixture usable for the next run.
  await call(`/users/${id}/reset-password`, {
    method: "POST",
    token: admin,
    body: { password: oldPassword },
  });
}

// -------------------------------------------------------- audit trail
console.log("\naudit trail");
{
  const login = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const admin = login.json.accessToken;
  const rolesRes = await call("/roles", { token: admin });
  check("GET /roles returns 7 roles", rolesRes.json?.roles?.length === 7, `got ${rolesRes.json?.roles?.length}`);
  check("Super Admin holds all 18 permissions", rolesRes.json?.roles?.find((r) => r.name === "Super Admin")?.permissions?.length === 18);

  const perms = await call("/auth/permissions", { token: admin });
  check("permission matrix served from the server", perms.json?.permissions?.length === 18);
}

// ---------------------------------------------------------------- result
console.log(`\n${"=".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);