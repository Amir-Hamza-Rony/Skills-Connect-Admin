import { RequirePermission } from "@/components/require-auth"
import { ScopesPage } from "@/views/scopes"

export default function Page() {
  return (
    <RequirePermission perm="scopes.manage">
      <ScopesPage />
    </RequirePermission>
  )
}
