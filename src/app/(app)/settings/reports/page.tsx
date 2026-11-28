import { RequirePermission } from "@/components/require-auth"
import { ReportsPage } from "@/views/reports"

export default function Page() {
  return (
    <RequirePermission perm="reports.view">
      <ReportsPage />
    </RequirePermission>
  )
}
