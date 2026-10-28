import { Suspense } from "react"

import { RequirePermission } from "@/components/require-auth"
import { OrdersPage } from "@/views/orders"

export default function Page() {
  return (
    <RequirePermission perm="orders.view">
      <Suspense fallback={null}>
        <OrdersPage />
      </Suspense>
    </RequirePermission>
  )
}
