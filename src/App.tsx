import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import { useTheme } from "@/lib/theme"

// Temporary Day-1 theme preview. T6 replaces this with the app shell + dashboard.
function App() {
  const { theme, resolvedTheme } = useTheme()

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Skills Connect Admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Preference: <span className="font-semibold">{theme}</span>
            {" · "}Resolved:{" "}
            <span className="font-semibold">{resolvedTheme}</span>
          </p>
          <ThemeToggle />
        </CardContent>
      </Card>
    </div>
  )
}

export default App
