import { RequirePermission } from "@/components/require-auth"
import { DocumentsPage } from "@/views/documents"

export default function Page() {
  return (
    <RequirePermission perm="documents.view">
      <DocumentsPage />
    </RequirePermission>
  )
}
