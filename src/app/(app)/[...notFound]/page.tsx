import { PlaceholderPage } from "@/views/placeholder"

/** Unknown paths inside the authenticated shell keep the SPA's 404 screen. */
export default function CatchAllPage() {
  return <PlaceholderPage title="Not found" note="This route does not exist." />
}
