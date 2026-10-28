import { RequirePermission } from "@/components/require-auth"
import { TasksPage } from "@/views/tasks"

export default function Page() {
  return (
    <RequirePermission perm="orders.view">
      <TasksPage />
    </RequirePermission>
  )
}
