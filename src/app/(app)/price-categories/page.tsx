import { RequirePermission } from "@/components/require-auth"
import { PriceCategoriesPage } from "@/views/price-categories"

export default function Page() {
  return (
    <RequirePermission perm="pricing.manage">
      <PriceCategoriesPage />
    </RequirePermission>
  )
}
