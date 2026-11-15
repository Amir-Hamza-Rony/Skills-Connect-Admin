import { RequirePermission } from "@/components/require-auth"
import { CommissionRecordsPage } from "@/views/commission-records"

export default function Page() {
  return (
    <RequirePermission perm="commissions.manage">
      <CommissionRecordsPage />
    </RequirePermission>
  )
}
