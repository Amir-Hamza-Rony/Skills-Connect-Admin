import { RequirePermission } from "@/components/require-auth"
import { RtosPage } from "@/views/rtos"

export default function Page() {
  return (
    <RequirePermission perm="rto.manage">
      <RtosPage />
    </RequirePermission>
  )
}
