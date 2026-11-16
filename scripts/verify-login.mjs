/**
 * End-to-end login verification against the running local app.
 *
 * Runs the acceptance checks for the admin-login fix:
 *   1. Correct credentials authenticate (200) and return the Super Admin
 *      principal with the full permission set.
 *   2. Wrong password is rejected (401 INVALID_CREDENTIALS).
 *   3. Unknown user is rejected (401 INVALID_CREDENTIALS).
 *   4. /api/auth/me returns the principal for the issued access token.
 *   5. A users.manage-protected route (GET /api/users) works for Super Admin.
 *   6. Anonymous access to that route is still rejected (401) — auth not bypassed.
 *
 * NEVER prints the password, the access token, or any hash. The token lives in
 * a local variable for the duration of the run only.
 *
 * Usage: node scripts/verify-login.mjs [baseUrl]
 */

import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

const BASE = process.argv[2] ?? process.env.VERIFY_BASE_URL ?? "http://localhost:3001";
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
  if (ok) passed++;
  else failed++;
}

async function loginAttempt(e, p) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: e, password: p }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// 1 — correct credentials
const ok = await loginAttempt(email, password);
report(
  "correct credentials authenticate",
  ok.status === 200 && !!ok.body.accessToken && ok.body.user?.email === email,
  ok.status === 200
    ? `user=${ok.body.user?.email}, roleNames=${JSON.stringify(ok.body.user?.roleNames)}`
    : `status=${ok.status} code=${ok.body?.error?.code}`,
);
const token = ok.body?.accessToken;

if (token) {
  const perms = ok.body.user?.permissions ?? [];
  const expectedSuperAdminPerms = 20; // full matrix in src/lib/permissions.ts
  report(
    "Super Admin permission set preserved",
    ok.body.user?.roleNames?.includes("Super Admin") === true &&
      perms.length >= expectedSuperAdminPerms &&
      perms.includes("users.manage") &&
      perms.includes("roles.manage") &&
      perms.includes("settings.manage"),
    `permissions=${perms.length}`,
  );

  // 4 — /auth/me
  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meBody = await me.json().catch(() => ({}));
  report(
    "GET /api/auth/me returns the principal",
    me.status === 200 && meBody.user?.email === email && meBody.user?.roleNames?.includes("Super Admin"),
    `status=${me.status}`,
  );

  // 5 — protected route (users.manage) for Super Admin
  const users = await fetch(`${BASE}/api/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const usersBody = await users.json().catch(() => ({}));
  const usersCount = Array.isArray(usersBody.users) ? usersBody.users.length : -1;
  report(
    "GET /api/users (users.manage) allowed for Super Admin",
    users.status === 200 && usersCount >= 1,
    `status=${users.status}, users=${usersCount >= 0 ? usersCount : "?"}`,
  );

  // 6 — anonymous still rejected
  const anon = await fetch(`${BASE}/api/users`);
  report(
    "anonymous /api/users still rejected (401)",
    anon.status === 401,
    `status=${anon.status}`,
  );
} else {
  report("Super Admin permission set preserved", false, "no token from successful login");
  report("GET /api/auth/me returns the principal", false, "skipped");
  report("GET /api/users (users.manage) allowed for Super Admin", false, "skipped");
  report("anonymous /api/users still rejected (401)", false, "skipped");
}

// 2 — wrong password (a value that is certainly NOT the seed password)
const wrong = await loginAttempt(email, "definitely-wrong-password-not-used");
report(
  "wrong password rejected",
  wrong.status === 401 && wrong.body?.error?.code === "INVALID_CREDENTIALS",
  `status=${wrong.status} code=${wrong.body?.error?.code}`,
);

// 3 — unknown user
const unknown = await loginAttempt("no.such.user@skillsconnect.example", "irrelevant-password");
report(
  "unknown user rejected",
  unknown.status === 401 && unknown.body?.error?.code === "INVALID_CREDENTIALS",
  `status=${unknown.status} code=${unknown.body?.error?.code}`,
);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
