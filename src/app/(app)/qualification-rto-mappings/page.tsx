import { RequirePermission } from "@/components/require-auth"
import { QualificationRtoMappingsPage } from "@/views/qualification-rto-mappings"

export default function Page() {
  return (
    <RequirePermission perm="qualifications.manage">
      <QualificationRtoMappingsPage />
    </RequirePermission>
  )
}
