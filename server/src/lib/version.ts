import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves `server/package.json` from both `src/lib` (tsx) and `dist/lib`
 * (compiled) — the relative path is identical in both layouts.
 * Falls back to "0.1.0" if the file cannot be read so `/health` never fails.
 */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, "../../package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

export const VERSION = readVersion();
export const SERVICE_NAME = "skills-connect-admin-api";