import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    env: {
      // Tests must never touch the real Atlas cluster or Redis — a fake URI
      // keeps `connectDb()` out of the way while still exercising the module
      // graph. `NODE_ENV=test` silences the logger.
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      MONGODB_URI: "mongodb://127.0.0.1:27017/skills_connect_admin_test",
      MONGODB_DB: "skills_connect_admin_test",
    },
  },
});