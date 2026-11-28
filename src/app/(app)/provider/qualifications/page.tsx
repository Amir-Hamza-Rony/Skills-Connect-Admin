import { RequirePermission } from "@/components/require-auth"
import { QualificationsPage } from "@/views/qualifications"

export default function Page() {
  return (
    <RequirePermission perm="qualifications.manage">
      <QualificationsPage />
    </RequirePermission>
  )
}
