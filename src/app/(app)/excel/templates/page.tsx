import { RequirePermission } from "@/components/require-auth"
import { ExcelTemplatesPage } from "@/views/excel-templates"

export default function Page() {
  return (
    <RequirePermission perm="finance.manage">
      <ExcelTemplatesPage />
    </RequirePermission>
  )
}
