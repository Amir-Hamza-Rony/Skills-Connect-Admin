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

  // Fix 1: requirePermissionission -> requirePermission (thorough)
  content = content.replace(/requirePermissionission/g, "requirePermission");

  // Fix 2: import from "@/lib/auth" -> "@/lib/api-auth"
  content = content.replace(/from "@\/lib\/auth"/g, 'from "@/lib/api-auth"');

  // Fix 3: requirePerm -> requirePermission
  content = content.replace(/requirePerm/g, "requirePermission");

  // Fix 4: toObjectId(params?.id ?? "") -> toObjectId(String(params?.id ?? ""))
  content = content.replace(/toObjectId\(params\?\.id \?\? ""\)/g, 'toObjectId(String(params?.id ?? ""))');

  // Fix 5: params?.id used as index -> params?.id as string
  content = content.replace(/params\?\.id/g, "params?.id as string");

  // Fix 6: MongoDB $push with $each or history - cast as any (more thorough)
  content = content.replace(
    /\$push:\s*\{\s*\$each:\s*([^}]+)\s*\}/g,
    "$push: { $each: $1 } as any"
  );
  content = content.replace(
    /\$push:\s*\{\s*history:\s*([^}]+)\s*\}/g,
    "$push: { history: $1 } as any"
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log("Fixed:", filePath);
  }
}

processDir(apiDir);
console.log("Done processing all route files.");
