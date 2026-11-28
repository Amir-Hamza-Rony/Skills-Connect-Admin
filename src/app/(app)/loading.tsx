import { Skeleton } from "@/components/ui/skeleton"

/**
 * Automatic loading UI shown during navigation between any (app) route.
 * Next.js displays this immediately on route change, before the new page
 * finishes server-rendering and hydrating.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            <Skeleton className="h-8 w-32" />
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <Skeleton className="h-4 w-1/3" />
          </p>
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-3/4" />
      </div>
    </div>
  )
}
