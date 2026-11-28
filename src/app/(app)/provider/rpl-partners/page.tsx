import { RequirePermission } from "@/components/require-auth"
import { RplPartnersPage } from "@/views/rpl-partners"

export default function Page() {
  return (
    <RequirePermission perm="rplPartners.view">
      <RplPartnersPage />
    </RequirePermission>
  )
}
