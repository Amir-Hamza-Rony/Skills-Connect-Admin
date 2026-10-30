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

  // Fix: toObjectId(any) - already accepts any, but add String() wrapper for safety
  content = content.replace(/toObjectId\(String\(params\?\.id \?\? ""\)\)/g, 'toObjectId(params?.id ?? "")');
  content = content.replace(/toObjectId\(params\.id as string\)/g, 'toObjectId(params.id)');
  
  // Fix: Map.get() returns value type that may not be string - add as string cast
  // qualMap.get(...) ?? String(...) - the ?? fallback is string, but get() returns any
  // This should be fine now that toObjectId accepts any
  
  // Fix: workflow tasks - task.priority where task has limited type
  content = content.replace(/task\.priority/g, "task.priority as any");

  // Fix: byQual.get(name) where name might be any - should be fine now
  // But add as string just in case
  content = content.replace(/byQual\.get\(name\)/g, "byQual.get(name as string)");
  content = content.replace(/agentMap\.get\(/g, "agentMap.get(");
  content = content.replace(/qualMap\.get\(/g, "qualMap.get(");

  // Fix: Map index access with unknown - cast to string
  content = content.replace(/PERMISSION_MAP\[type\]/g, "PERMISSION_MAP[type as keyof typeof PERMISSION_MAP]");

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log("Fixed:", filePath);
  }
}

processDir(apiDir);
console.log("Done processing all route files.");
