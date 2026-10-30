const fs = require("fs");
const path = require("path");

const apiDir = path.join(process.cwd(), "src", "app", "api");
const middlewareDir = path.join(process.cwd(), "src", "middleware");

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

  // Fix 1: requirePermissionission -> requirePermission (double replacement bug)
  content = content.replace(/requirePermissionission/g, "requirePermission");

  // Fix 2: import from "@/lib/auth" -> "@/lib/api-auth" (catch any missed ones)
  content = content.replace(/from "@\/lib\/auth"/g, 'from "@/lib/api-auth"');

  // Fix 3: requirePerm -> requirePermission
  content = content.replace(/requirePerm/g, "requirePermission");

  // Fix 4: params?.id -> params?.id ?? "" in toObjectId calls
  content = content.replace(/toObjectId\(params\?\.id \?\? ""\)/g, "toObjectId(params?.id ?? \"\")");
  // Also handle: toObjectId(params?.id) where params?.id could be undefined
  content = content.replace(/toObjectId\(params\?\.id\)/g, "toObjectId(params?.id ?? \"\")");

  // Fix 5: RouteHandler parameter type - make params type more permissive
  // Change: async (req, { params }: { params?: { id: string } | undefined }) =>
  // To: async (req, { params }: { params?: { id?: string; type?: string } | undefined }) =>
  content = content.replace(
    /\{ params\?: \{ id: string \} \|\s*undefined \}/g,
    "{ params?: { id?: string; type?: string } | undefined }"
  );

  // Fix 6: MongoDB $push with $each - cast as any
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
