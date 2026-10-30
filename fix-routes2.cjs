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
  let modified = false;

  // Fix 1: withAuth(requirePermission("X"), handler) -> withAuth("X", handler)
  const permPattern = /withAuth\(\s*requirePermission\("([^"]+)"\)\s*,/g;
  content = content.replace(permPattern, (match, perm) => {
    modified = true;
    return `withAuth("${perm}",`;
  });

  // Fix 2: import { clearRefreshCookie } from "@/lib/auth" -> "@/lib/api-auth"
  content = content.replace(/from "@\/lib\/auth"/g, 'from "@/lib/api-auth"');
  if (content.includes('from "@/lib/api-auth"')) modified = true;

  // Fix 3: import { verifyAccessToken } from "@/lib/auth" -> "@/lib/api-auth"
  // (already covered by the general replacement above)

  // Fix 4: requirePerm -> requirePermission
  content = content.replace(/requirePerm/g, "requirePermission");
  if (content.includes("requirePermission") && !content.includes("requirePerm")) modified = true;

  // Fix 5: params?.id -> (params?.id ?? "") 
  // This is trickier - need to find toObjectId(params?.id) patterns
  const paramsIdPattern = /toObjectId\(params\?\.id\)/g;
  content = content.replace(paramsIdPattern, "toObjectId(params?.id ?? \"\")");
  if (content.includes('params?.id ?? ""')) modified = true;

  // Fix 6: MongoDB $push with $each - wrap in any cast
  const pushEachPattern = /\$push:\s*\{\s*\$each:/g;
  if (pushEachPattern.test(content)) {
    // Replace {$push: { $each: history }} with {$push: { $each: history } as any}
    content = content.replace(/\$push:\s*\{\s*\$each:\s*(\w+)\s*\}/g, (match, varName) => {
      modified = true;
      return `$push: { \$each: ${varName} } as any`;
    });
  }

  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log("Fixed:", filePath);
  }
}

processDir(apiDir);
console.log("Done processing all route files.");
