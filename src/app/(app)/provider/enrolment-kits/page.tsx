import { RequirePermission } from "@/components/require-auth"
import { EnrolmentKitsPage } from "@/views/enrolment-kits"

export default function Page() {
  return (
    <RequirePermission perm="scopes.manage">
      <EnrolmentKitsPage />
    </RequirePermission>
  )
}
