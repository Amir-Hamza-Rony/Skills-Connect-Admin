import { RequirePermission } from "@/components/require-auth"
import { PriceListsPage } from "@/views/price-lists"

export default function Page() {
  return (
    <RequirePermission perm="pricing.manage">
      <PriceListsPage />
    </RequirePermission>
  )
}
