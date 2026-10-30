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
      let content = fs.readFileSync(fullPath, "utf8");
      let original = content;
      
      // Fix requirePermissionission -> requirePermission
      content = content.replace(/requirePermissionission/g, "requirePermission");
      
      if (content !== original) {
        fs.writeFileSync(fullPath, content);
        console.log("Fixed perm:", fullPath);
      }
    }
  }
}

processDir(apiDir);
console.log("Done.");
