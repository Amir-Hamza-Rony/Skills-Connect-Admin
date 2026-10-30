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

  // Fix 1: withAuth(requirePermission("X"), handler) -> withAuth("X", handler)
  content = content.replace(/withAuth\(\s*requirePermission\("([^"]+)"\)\s*,/g, 'withAuth("$1",');

  // Fix 2: import from "@/lib/auth" -> "@/lib/api-auth"
  content = content.replace(/from "@\/lib\/auth"/g, 'from "@/lib/api-auth"');

  // Fix 3: toObjectId(params?.id as string ?? "") -> toObjectId(String(params?.id ?? ""))
  content = content.replace(/toObjectId\(params\?\.id as string \?\? ""\)/g, 'toObjectId(String(params?.id ?? ""))');
  // Also handle: toObjectId(params?.id) where params is Record<string, unknown>
  content = content.replace(/toObjectId\(params\?\.id\)/g, 'toObjectId(String(params?.id ?? ""))');
  // Handle: toObjectId(params.id) where params is Record<string, unknown>
  content = content.replace(/toObjectId\(params\.id\)/g, 'toObjectId(String(params.id ?? ""))');

  // Fix 4: params.id or params.type used as index -> cast as string
  content = content.replace(/params\.id/g, "params.id as string");
  content = content.replace(/params\.type/g, "params.type as string");

  // Fix 5: MongoDB $push with $each or history - cast as any
  content = content.replace(
    /\$push:\s*\{\s*\$each:\s*([^}]+?)\s*\}/g,
    "$push: { $each: $1 } as any"
  );
  content = content.replace(
    /\$push:\s*\{\s*history:\s*([^}]+?)\s*\}/g,
    "$push: { history: $1 } as any"
  );

  // Fix 6: workflow tasks - task.priority where task is { status, assigneeId, dueDate }
  content = content.replace(/task\.priority/g, "task.priority as any");

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log("Fixed:", filePath);
  }
}

processDir(apiDir);
console.log("Done processing all route files.");
