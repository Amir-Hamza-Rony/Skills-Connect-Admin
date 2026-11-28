import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      // Phase 5: legacy path → new canonical path (301 permanent)
      { source: "/clients", destination: "/candidates", permanent: true },
      { source: "/orders", destination: "/enrolments", permanent: true },
      { source: "/qualifications", destination: "/provider/qualifications", permanent: true },
      { source: "/rtos", destination: "/provider/rtos", permanent: true },
      { source: "/scopes", destination: "/provider/scopes", permanent: true },
      { source: "/enrolment-kits", destination: "/provider/enrolment-kits", permanent: true },
      { source: "/agents", destination: "/sales/agents", permanent: true },
      { source: "/pricing", destination: "/pricing/pricing", permanent: true },
      { source: "/price-categories", destination: "/pricing/categories", permanent: true },
      { source: "/price-lists", destination: "/pricing/lists", permanent: true },
      { source: "/additional-fees", destination: "/pricing/fees", permanent: true },
      { source: "/finance", destination: "/finance/finance", permanent: true },
      { source: "/commission-rules", destination: "/finance/commission-rules", permanent: true },
      { source: "/commission-records", destination: "/finance/commission-records", permanent: true },
      { source: "/commission-payouts", destination: "/finance/commission-payouts", permanent: true },
      { source: "/reports", destination: "/settings/reports", permanent: true },
      { source: "/audit", destination: "/settings/audit", permanent: true },
      { source: "/users", destination: "/settings/users", permanent: true },
      { source: "/roles", destination: "/settings/roles", permanent: true },
      { source: "/settings", destination: "/settings/settings", permanent: true },
      { source: "/integrations/quickbooks", destination: "/settings/quickbooks", permanent: true },
      { source: "/reconciliation", destination: "/settings/reconciliation", permanent: true },
    ]
  },
}

export default nextConfig
