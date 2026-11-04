import { RequirePermission } from "@/components/require-auth"
import { ReconciliationPage } from "@/views/reconciliation"

export default function Page() {
  return (
    <RequirePermission perm="finance.reconcile">
      <ReconciliationPage />
    </RequirePermission>
  )
}
