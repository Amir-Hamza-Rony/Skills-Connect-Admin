import { RequirePermission } from "@/components/require-auth"
import { ExcelUploadPage } from "@/views/excel-upload"

export default function Page() {
  return (
    <RequirePermission perm="finance.manage">
      <ExcelUploadPage />
    </RequirePermission>
  )
}
