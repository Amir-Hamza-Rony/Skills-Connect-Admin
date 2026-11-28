import { RequirePermission } from "@/components/require-auth"
import { AuditPage } from "@/views/audit"

export default function Page() {
  return (
    <RequirePermission perm="audit.view">
      <AuditPage />
    </RequirePermission>
  )
}
