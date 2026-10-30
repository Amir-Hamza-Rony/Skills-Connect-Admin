const fs = require("fs");
const path = require("path");

const apiDir = path.join(process.cwd(), "src", "app", "api");

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDir(fullPath);
    } else if (entry.name === "route.ts") {
      fixRouteFile(fullPath);
    }
  }
}

function fixRouteFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  let original = content;

  // Fix 1: requirePermissionission -> requirePermission
  content = content.replace(/requirePermissionission/g, "requirePermission");

  // Fix 2: import from "@/lib/auth" -> "@/lib/api-auth"
  content = content.replace(/from "@\/lib\/auth"/g, 'from "@/lib/api-auth"');

  // Fix 3: requirePerm -> requirePermission
  content = content.replace(/requirePerm/g, "requirePermission");

  // Fix 4: params?.id -> params?.id ?? "" in toObjectId calls
  content = content.replace(/toObjectId\(params\?\.id \?\? ""\)/g, "toObjectId(params?.id ?? \"\")");
  content = content.replace(/toObjectId\(params\?\.id\)/g, "toObjectId(params?.id ?? \"\")");

  // Fix 5: RouteHandler param type - change specific params type to Record<string, unknown>
  // This matches what RouteHandler expects
  content = content.replace(
    /\{ params\?: \{ id: string \} \|\s*undefined \}/g,
    "{ params?: Record<string, unknown> | undefined }"
  );
  content = content.replace(
    /\{ params\?: \{ type: string \} \|\s*undefined \}/g,
    "{ params?: Record<string, unknown> | undefined }"
  );
  content = content.replace(
    /\{ params\?: \{ id: string \} \}/g,
    "{ params?: Record<string, unknown> | undefined }"
  );
  content = content.replace(
    /\{ params\?: \{ type: string \} \}/g,
    "{ params?: Record<string, unknown> | undefined }"
  );

  // Fix 6: MongoDB $push with $each or history - cast as any
  content = content.replace(
    /\$push:\s*\{\s*\$each:\s*(\w+)\s*\}/g,
    "$push: { $each: $1 } as any"
  );
  content = content.replace(
    /\$push:\s*\{\s*history:\s*(\w+)\s*\}/g,
    "$push: { history: $1 } as any"
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log("Fixed:", filePath);
  }
}

processDir(apiDir);
console.log("Done processing all route files.");
