import fs from "fs";
import path from "path";

/**
 * Load .env into process.env (vitest does not load it automatically) and
 * point the MongoDB client at a dedicated test database so tests never mutate
 * production data in `skills_connect_admin`.
 */
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

process.env.MONGODB_DB = "skills_connect_admin_test";
process.env.NODE_ENV = "test";
