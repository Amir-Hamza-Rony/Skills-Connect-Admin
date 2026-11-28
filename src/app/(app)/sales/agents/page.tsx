import { RequirePermission } from "@/components/require-auth"
import { AgentsPage } from "@/views/agents"

export default function Page() {
  return (
    <RequirePermission perm="agents.manage">
      <AgentsPage />
    </RequirePermission>
  )
}
