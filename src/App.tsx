import { AppShell } from "@/components/layout/app-shell"
import { Skeleton } from "@/components/ui/skeleton"

// Temporary Day-1 shell preview with scrollable placeholder content so the
// independent sidebar/content scrolling can be verified. T6 replaces this
// with the premium dashboard.
function App() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Shell preview — dashboard content lands in T6.
          </p>
        </div>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </AppShell>
  )
}

export default App
