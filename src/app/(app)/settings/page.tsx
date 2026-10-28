import { RequirePermission } from "@/components/require-auth"
import { SettingsPage } from "@/views/settings"

export default function Page() {
  return (
    <RequirePermission perm="settings.manage">
      <SettingsPage />
    </RequirePermission>
  )
}
