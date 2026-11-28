import { RequirePermission } from "@/components/require-auth"
import { QuickBooksPage } from "@/views/quickbooks"

export default function Page() {
  return (
    <RequirePermission perm="qb.manage">
      <QuickBooksPage />
    </RequirePermission>
  )
}
