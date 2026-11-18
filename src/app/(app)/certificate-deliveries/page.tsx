import { RequirePermission } from "@/components/require-auth"
import { CertificateDeliveriesPage } from "@/views/certificate-deliveries"

export default function Page() {
  return (
    <RequirePermission perm="rplPartners.view">
      <CertificateDeliveriesPage />
    </RequirePermission>
  )
}
