import { RequirePermission } from "@/components/require-auth"
import { BDCCommissionLedgerPage } from "@/views/bdc-commission-ledger"

export default function Page() {
  return (
    <RequirePermission perm="commissions.view">
      <BDCCommissionLedgerPage />
    </RequirePermission>
  )
}
