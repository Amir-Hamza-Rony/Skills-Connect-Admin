import { RequirePermission } from "@/components/require-auth"
import { RolesPage } from "@/views/roles"

export default function Page() {
  return (
    <RequirePermission perm="roles.manage">
      <RolesPage />
    </RequirePermission>
  )
}
