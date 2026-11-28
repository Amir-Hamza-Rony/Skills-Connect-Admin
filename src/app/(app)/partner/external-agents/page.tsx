import { RequirePermission } from "@/components/require-auth"
import { ExternalAgentsPage } from "@/views/external-agents"

export default function Page() {
  return (
    <RequirePermission perm="clients.view">
      <ExternalAgentsPage />
    </RequirePermission>
  )
}
