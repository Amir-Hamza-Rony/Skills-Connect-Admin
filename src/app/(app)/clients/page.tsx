import { RequirePermission } from "@/components/require-auth"
import { ClientsPage } from "@/views/clients"

export default function Page() {
  return (
    <RequirePermission perm="clients.view">
      <ClientsPage />
    </RequirePermission>
  )
}
