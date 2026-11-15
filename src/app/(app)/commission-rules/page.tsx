import { RequirePermission } from "@/components/require-auth"
import { CommissionRulesPage } from "@/views/commission-rules"

export default function Page() {
  return (
    <RequirePermission perm="commissions.manage">
      <CommissionRulesPage />
    </RequirePermission>
  )
}
