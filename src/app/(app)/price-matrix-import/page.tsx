import { RequirePermission } from "@/components/require-auth"
import { PriceMatrixImportPage } from "@/views/price-matrix-import"

export default function Page() {
  return (
    <RequirePermission perm="pricing.manage">
      <PriceMatrixImportPage />
    </RequirePermission>
  )
}
