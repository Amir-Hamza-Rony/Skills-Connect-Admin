import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    // Suites that use the in-memory Mongo need room to download/spawn it once.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Mongoose models and rate-limit singletons are module state; running files
    // in separate processes keeps them isolated.
    pool: "forks",
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      MONGODB_URI: "mongodb://127.0.0.1:27017/skills_connect_admin_test",
      MONGODB_DB: "skills_connect_admin_test",
      // Test-only secrets. Never reuse a real deployment's values here.
      JWT_ACCESS_SECRET: "test-only-access-secret-0000000000000000000000000000",
      JWT_REFRESH_SECRET: "test-only-refresh-secret-111111111111111111111111111",
      COOKIE_SECURE: "false",
      COOKIE_SAME_SITE: "lax",
    },
  },
});