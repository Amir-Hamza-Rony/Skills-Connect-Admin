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
  let modified = false;

  // Fix 1: collection("name").method() -> await collection first, then call method
  // Pattern: const x = await collection("name").find(...)
  // Needs to be: const coll = await collection("name"); const x = await coll.find(...)
  // This is complex regex, so let's handle common patterns

  // Fix: await collection("X").find() -> const coll = await collection("X"); const result = await coll.find()
  const findPattern = /const (\w+) = await collection\("([^"]+)"\)\.find\(/g;
  content = content.replace(findPattern, (match, varName, collName) => {
    modified = true;
    return `const ${varName}Coll = await collection("${collName}");\n    const ${varName} = await ${varName}Coll.find(`;
  });

  // Fix: await collection("X").findOne() -> const coll = await collection("X"); const result = await coll.findOne()
  const findOnePattern = /const (\w+) = await collection\("([^"]+)"\)\.findOne\(/g;
  content = content.replace(findOnePattern, (match, varName, collName) => {
    modified = true;
    return `const ${varName}Coll = await collection("${collName}");\n    const ${varName} = await ${varName}Coll.findOne(`;
  });

  // Fix: await collection("X").insertOne() -> const coll = await collection("X"); const result = await coll.insertOne()
  const insertOnePattern = /const (\w+) = await collection\("([^"]+)"\)\.insertOne\(/g;
  content = content.replace(insertOnePattern, (match, varName, collName) => {
    modified = true;
    return `const ${varName}Coll = await collection("${collName}");\n    const ${varName} = await ${varName}Coll.insertOne(`;
  });

  // Fix: await collection("X").updateOne() -> const coll = await collection("X"); const result = await coll.updateOne()
  const updateOnePattern = /await collection\("([^"]+)"\)\.updateOne\(/g;
  content = content.replace(updateOnePattern, (match, collName) => {
    modified = true;
    return `const ${collName}Coll = await collection("${collName}");\n    await ${collName}Coll.updateOne(`;
  });

  // Fix: await collection("X").insertMany() -> const coll = await collection("X"); const result = await coll.insertMany()
  const insertManyPattern = /await collection\("([^"]+)"\)\.insertMany\(/g;
  content = content.replace(insertManyPattern, (match, collName) => {
    modified = true;
    return `const ${collName}Coll = await collection("${collName}");\n    await ${collName}Coll.insertMany(`;
  });

  // Fix: await collection("X").countDocuments() -> const coll = await collection("X"); const result = await coll.countDocuments()
  const countPattern = /const (\w+) = await collection\("([^"]+)"\)\.countDocuments\(/g;
  content = content.replace(countPattern, (match, varName, collName) => {
    modified = true;
    return `const ${varName}Coll = await collection("${collName}");\n    const ${varName} = await ${varName}Coll.countDocuments(`;
  });

  // Fix: await collection("X").distinct() -> const coll = await collection("X"); const result = await coll.distinct()
  const distinctPattern = /const (\w+) = await collection\("([^"]+)"\)\.distinct\(/g;
  content = content.replace(distinctPattern, (match, varName, collName) => {
    modified = true;
    return `const ${varName}Coll = await collection("${collName}");\n    const ${varName} = await ${varName}Coll.distinct(`;
  });

  // Fix 2: params?.id -> params?.id ?? "" or handle undefined
  // Fix 3: import from "@/lib/auth" -> "@/lib/api-auth" (already done for most)

  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log("Fixed:", filePath);
  }
}

processDir(apiDir);
console.log("Done processing all route files.");
