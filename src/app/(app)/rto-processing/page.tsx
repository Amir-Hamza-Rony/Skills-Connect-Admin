import { RequirePermission } from "@/components/require-auth"
import { RtoProcessingPage } from "@/views/rto-processing"

export default function Page() {
  return (
    <RequirePermission perm="rto.manage">
      <RtoProcessingPage />
    </RequirePermission>
  )
}
