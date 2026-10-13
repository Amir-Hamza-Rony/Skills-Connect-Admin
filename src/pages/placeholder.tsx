import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/** Placeholder for modules landing in later phases (Day 3–4). */
export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        <Badge variant="info">Preview shell</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming soon</CardTitle>
          <CardDescription>{note}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This module is planned and documented in{" "}
            <code>workflow.md</code> — UI lands in its scheduled phase with no
            fake data.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
