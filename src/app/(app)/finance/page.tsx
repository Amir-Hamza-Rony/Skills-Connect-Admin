import { RequirePermission } from "@/components/require-auth"
import { FinancePage } from "@/views/finance"

export default function Page() {
  return (
    <RequirePermission perm="finance.view">
      <FinancePage />
    </RequirePermission>
  )
}
