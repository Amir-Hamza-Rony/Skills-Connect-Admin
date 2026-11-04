import { RequirePermission } from "@/components/require-auth"
import { CommissionPayoutsPage } from "@/views/commission-payouts"

export default function Page() {
  return (
    <RequirePermission perm="commissions.manage">
      <CommissionPayoutsPage />
    </RequirePermission>
  )
}
