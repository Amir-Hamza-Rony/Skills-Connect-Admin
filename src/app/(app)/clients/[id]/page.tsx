import { RequirePermission } from "@/components/require-auth"
import { ClientProfilePage } from "@/views/client-profile"

export default function Page() {
  return (
    <RequirePermission perm="clients.view">
      <ClientProfilePage />
    </RequirePermission>
  )
}
