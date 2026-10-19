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

async function call(path, { method = "GET", body, token, jar, headers: extraHeaders } = {}) {
  const headers = { ...extraHeaders };
  if (body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (jar) headers.Cookie = jar.header();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    // A pre-serialised body is sent verbatim — the QuickBooks webhook signs the
    // exact bytes, so it must not be re-encoded on the way out.
    body: typeof body === "string" ? body : body ? JSON.stringify(body) : undefined,
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

    // Leave the fixture usable for the next run. Without this the fixture stays
    // deactivated and the *next* run's "sales user can sign in" fails with a
    // misleading 403 that looks like a security bug.
    await call(`/users/${salesId}`, { method: "PATCH", token: admin, body: { active: true } });
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

// ---------------------------------------------------------- B3: clients & orders
console.log("\nB3 — clients, orders, workflow");
{
  const login = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const admin = login.json.accessToken;

  // Unique per run so the script is re-runnable against a persistent database.
  const email = `smoke-b3-${Date.now()}@example.com`;
  const created = await call("/clients", {
    method: "POST",
    token: admin,
    body: { legalName: "Smoke B3 Client", email, phone: "0411 000 000" },
  });
  check("client can be created (201)", created.status === 201, `got ${created.status}`);
  check("new client starts as Prospect", created.json?.client?.status === "Prospect");

  const dupe = await call("/clients", {
    method: "POST",
    token: admin,
    body: { legalName: "Smoke B3 Dupe", email },
  });
  check("duplicate email is rejected (409)", dupe.status === 409, `got ${dupe.status}`);

  const clientId = created.json?.client?.id;
  const list = await call(`/clients?search=${encodeURIComponent(email)}`, { token: admin });
  check("client search finds the new client", list.json?.clients?.length === 1);

  const fetched = await call(`/clients/${clientId}`, { token: admin });
  check("client can be fetched by id", fetched.status === 200, `got ${fetched.status}`);

  const patched = await call(`/clients/${clientId}`, {
    method: "PATCH",
    token: admin,
    body: { status: "Active" },
  });
  check("client can be updated", patched.json?.client?.status === "Active");

  // Valid-but-nonexistent master ids: no supplier route matches, so the order
  // must be refused rather than created with a zero cost snapshot.
  const missing = "000000000000000000000000";
  const noRoute = await call("/orders", {
    method: "POST",
    token: admin,
    body: { clientId, qualificationId: missing, salesAgentId: missing, sourceAgentId: missing, rtoId: missing, sellingPrice: 2500 },
  });
  check("order without an active route is refused (422)", noRoute.status === 422, `got ${noRoute.status}`);
  check("refusal names the reason", noRoute.json?.error?.code === "NO_ACTIVE_ROUTE", noRoute.json?.error?.code);

  const badId = await call("/orders", {
    method: "POST",
    token: admin,
    body: { clientId: "not-an-object-id", qualificationId: "x", salesAgentId: "x", sourceAgentId: "x", rtoId: "x", sellingPrice: 2500 },
  });
  check("order with a malformed id is refused (400)", badId.status === 400, `got ${badId.status}`);

  const anonClient = await call("/clients");
  check("anonymous /clients -> 401", anonClient.status === 401, `got ${anonClient.status}`);
}

// ---------------------------------------------------------- B4: documents
console.log("\nB4 — documents");
{
  const login = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const admin = login.json.accessToken;

  const list = await call("/orders/000000000000000000000000/documents", { token: admin });
  check("GET /orders/:id/documents returns an empty list", list.status === 200 && list.json?.documents?.length === 0, `got ${list.status}`);

  // Storage is not configured in every environment, but the endpoint must fail
  // cleanly with a named reason rather than a 500.
  const up = await call("/documents/upload-url", {
    method: "POST",
    token: admin,
    body: { orderId: "000000000000000000000000", type: "USI transcript", contentType: "application/pdf" },
  });
  check("POST /documents/upload-url fails cleanly without storage", up.status === 422, `got ${up.status}`);
  check("refusal names the reason", up.json?.error?.code === "STORAGE_NOT_CONFIGURED", up.json?.error?.code);

  const anon = await call("/documents/upload-url", {
    method: "POST",
    body: { orderId: "x", type: "y", contentType: "z" },
  });
  check("anonymous upload-url -> 401", anon.status === 401, `got ${anon.status}`);
}

// ------------------------------------------------------------- B5: finance
console.log("\nB5 — finance + QuickBooks");
{
  const login = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const admin = login.json.accessToken;

  const status = await call("/integrations/quickbooks/status", { token: admin });
  check("GET /integrations/quickbooks/status returns 200", status.status === 200, `got ${status.status}`);
  check("status exposes booleans, never tokens", typeof status.json?.configured === "boolean" && typeof status.json?.authorised === "boolean");
  check("status never leaks token material", !JSON.stringify(status.json ?? {}).includes("accessToken"));
  check("an unconfigured integration explains itself", status.json?.configured === true || typeof status.json?.hint === "string");

  const queue = await call("/integrations/quickbooks/sync", { token: admin });
  check("GET the sync queue returns 200", queue.status === 200, `got ${queue.status}`);
  check("sync queue is a list", Array.isArray(queue.json?.records));

  const unknown = await call("/integrations/quickbooks/sync/invoice/000000000000000000000000", { token: admin });
  check("unknown sync record -> 404", unknown.status === 404, `got ${unknown.status}`);

  const badType = await call("/integrations/quickbooks/sync/widget/000000000000000000000000", { token: admin });
  check("unknown entity type -> 400", badType.status === 400, `got ${badType.status}`);

  const anonStatus = await call("/integrations/quickbooks/status");
  check("anonymous /integrations/quickbooks/status -> 401", anonStatus.status === 401, `got ${anonStatus.status}`);

  // The webhook authenticates with Intuit's HMAC over the raw body, not with a
  // session. Unconfigured or unsigned it must refuse rather than trust it.
  const webhook = await call("/integrations/quickbooks/webhook", {
    method: "POST",
    body: JSON.stringify({ eventNotifications: [{ realmId: "1", dataChangeEvent: { entities: [{ Id: "1" }] } }] }),
    headers: { "Content-Type": "application/json" },
  });
  check("unsigned QB webhook is refused (401)", webhook.status === 401, `got ${webhook.status}`);
}


// ------------------------------------------------------------- B6: reports
console.log("\nB6 � reports + audit");
{
  const login = await call("/auth/login", { method: "POST", body: { email: ADMIN, password: PASSWORD } });
  const admin = login.json.accessToken;

  const finance = await call("/reports/finance", { token: admin });
  check("GET /reports/finance returns 200", finance.status === 200, `got ${finance.status}`);
  check("finance report has the headline fields", ["invoiced", "collected", "outstanding", "overdueCount"].every((k) => k in (finance.json ?? {})));
  check("invoiced minus collected equals outstanding", finance.json?.invoiced - finance.json?.collected === finance.json?.outstanding);

  const revenue = await call("/reports/revenue", { token: admin });
  check("GET /reports/revenue returns 200", revenue.status === 200, `got ${revenue.status}`);
  check("revenue report groups by qualification and agent", Array.isArray(revenue.json?.byQualification) && Array.isArray(revenue.json?.byAgent));

  const margin = await call("/reports/margin", { token: admin });
  check("GET /reports/margin returns 200", margin.status === 200, `got ${margin.status}`);
  check("margin rows carry a percentage", Array.isArray(margin.json?.byQualification) && margin.json.byQualification.every((r) => typeof r.percent === "number"));

  const funnel = await call("/reports/funnel", { token: admin });
  check("GET /reports/funnel returns 200", funnel.status === 200, `got ${funnel.status}`);
  check("funnel reports a conversion percentage", typeof funnel.json?.conversionPercent === "number");

  const ageing = await call("/reports/ageing", { token: admin });
  check("GET /reports/ageing returns 200", ageing.status === 200, `got ${ageing.status}`);
  check("ageing buckets the overdue total", ageing.json?.buckets?.reduce((s, b) => s + b.amount, 0) === ageing.json?.totalOverdue);

  const collections = await call("/reports/collections", { token: admin });
  check("GET /reports/collections returns 200", collections.status === 200, `got ${collections.status}`);
  check("collections are grouped by month", Array.isArray(collections.json?.months));

  const rtoTurn = await call("/reports/rto-turnaround", { token: admin });
  check("GET /reports/rto-turnaround returns 200", rtoTurn.status === 200, `got ${rtoTurn.status}`);

  // A filter that matches nothing must return empty groups, not an error.
  const empty = await call("/reports/finance?stage=NoSuchStage", { token: admin });
  check("an unknown stage filter is refused (400)", empty.status === 400, `got ${empty.status}`);

  // The audit log.
  const audit = await call("/audit", { token: admin });
  check("GET /audit returns 200", audit.status === 200, `got ${audit.status}`);
  check("audit is paginated with a total", typeof audit.json?.total === "number" && Array.isArray(audit.json?.events));

  const auditFilters = await call("/audit/filters", { token: admin });
  check("GET /audit/filters returns the vocabulary", auditFilters.status === 200 && Array.isArray(auditFilters.json?.entityTypes), `got ${auditFilters.status}`);

  const auditSearch = await call("/audit?search=order.create&pageSize=5", { token: admin });
  check("audit search respects the page size", (auditSearch.json?.events?.length ?? 99) <= 5, `got ${auditSearch.json?.events?.length}`);

  const anonAudit = await call("/audit");
  check("anonymous /audit -> 401", anonAudit.status === 401, `got ${anonAudit.status}`);
}
// ---------------------------------------------------------------- result
console.log(`\n${"=".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"=".repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);