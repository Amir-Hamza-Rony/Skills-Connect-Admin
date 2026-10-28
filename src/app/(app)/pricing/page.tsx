import { RequirePermission } from "@/components/require-auth"
import { PricingPage } from "@/views/pricing"

export default function Page() {
  return (
    <RequirePermission perm="pricing.manage">
      <PricingPage />
    </RequirePermission>
  )
}
