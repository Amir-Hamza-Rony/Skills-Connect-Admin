import type { NextConfig } from "next"

/**
 * Single Next.js application serving frontend + API routes.
 * All API routes live under src/app/api/ and are called with relative
 * /api/* paths (see src/lib/api.ts). Set NEXT_PUBLIC_API_BASE_URL only
 * when calling a separate backend service; for a single Next.js
 * deployment leave it unset.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
}

export default nextConfig
