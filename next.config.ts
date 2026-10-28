import type { NextConfig } from "next"

/**
 * The Express API is a separate service (see `server/`). The browser reaches it
 * through `NEXT_PUBLIC_API_BASE_URL`, so no rewrite/proxy is required here.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
}

export default nextConfig
