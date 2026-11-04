import { RequirePermission } from "@/components/require-auth"
import { ExcelImportsPage } from "@/views/excel-imports"

export default function Page() {
  return (
    <RequirePermission perm="finance.manage">
      <ExcelImportsPage />
    </RequirePermission>
  )
}
