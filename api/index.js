/**
 * Vercel serverless function entry point for the Skills Connect Admin API.
 *
 * Imports the compiled Express app from `server/dist/app.js` and exports it
 * as the default Vercel handler. All API routes (/auth, /clients, /orders,
 * /documents, etc.) are served through this single function.
 *
 * Environment variables (set in the Vercel project settings):
 *   MONGODB_URI, MONGODB_DB, MONGODB_TIMEOUT_MS
 *   JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (must differ)
 *   ACCESS_TOKEN_TTL_MIN, REFRESH_TOKEN_TTL_DAYS
 *   COOKIE_SECURE (must be "true" in production)
 *   COOKIE_SAME_SITE ("lax" | "strict" | "none")
 *   CORS_ORIGINS (comma-separated, e.g. https://your-app.vercel.app)
 *   REDIS_URL (optional; inline fallback when absent)
 *   LOG_LEVEL, LOGIN_RATE_LIMIT_MAX, GLOBAL_RATE_LIMIT_MAX, ...
 *   QuickBooks vars (optional — sync degrades gracefully when absent)
 */
import { createApp } from "../server/dist/app.js";

const app = createApp();

export default app;
