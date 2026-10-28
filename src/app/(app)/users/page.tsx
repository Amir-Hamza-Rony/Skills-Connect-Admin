import { RequirePermission } from "@/components/require-auth"
import { UsersPage } from "@/views/users"

export default function Page() {
  return (
    <RequirePermission perm="users.manage">
      <UsersPage />
    </RequirePermission>
  )
}
