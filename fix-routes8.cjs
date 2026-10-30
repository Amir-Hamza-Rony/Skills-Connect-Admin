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

  // Fix 1: masters/[type]/route.ts - cast type to string for PERMISSION_MAP
  content = content.replace(/const perm = PERMISSION_MAP\[type\];/g, 'const perm = PERMISSION_MAP[String(type)];');

  // Fix 2: masters/[type]/route.ts - collection(type) where type might be unknown
  content = content.replace(/const coll = await collection\(type\);/g, 'const coll = await collection(String(type));');

  // Fix 3: Map type annotations - new Map(...)
  content = content.replace(
    /const qualMap = new Map\(qualifications\.map\(/g,
    "const qualMap = new Map<string, string>(qualifications.map("
  );
  content = content.replace(
    /const agentMap = new Map\(users\.map\(/g,
    "const agentMap = new Map<string, string>(users.map("
  );

  // Fix 4: workflow tasks priority
  content = content.replace(
    /status: task\.status, assigneeId: task\.assigneeId \? String\(task\.assigneeId\) : null, dueDate: task\.dueDate/,
    "status: task.status, assigneeId: task.assigneeId ? String(task.assigneeId) : null, dueDate: task.dueDate as any"
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log("Fixed:", filePath);
  }
}

processDir(apiDir);
console.log("Done processing all route files.");
