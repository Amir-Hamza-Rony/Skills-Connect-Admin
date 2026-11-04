import { RequirePermission } from "@/components/require-auth"
import { AdditionalFeesPage } from "@/views/additional-fees"

export default function Page() {
  return (
    <RequirePermission perm="pricing.manage">
      <AdditionalFeesPage />
    </RequirePermission>
  )
}
