import { RequirePermission } from "@/components/require-auth"
import { OrderDetailPage } from "@/views/order-detail"

export default function Page() {
  return (
    <RequirePermission perm="orders.view">
      <OrderDetailPage />
    </RequirePermission>
  )
}
