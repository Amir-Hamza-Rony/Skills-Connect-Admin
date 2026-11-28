"use client"

/**
 * Global error boundary for the Next.js App Router.
 * Catches unexpected errors during rendering and provides a graceful
 * fallback instead of a blank white screen.
 */

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    console.error("Global error caught:", error)
  }, [error])

  return (
    <html>
      <head>
        <title>Application Error</title>
      </head>
      <body className="flex min-h-dvh items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-card p-6 text-center">
          <h1 className="text-lg font-bold">Something went wrong</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <div className="flex justify-center gap-2 pt-4">
            <button
              type="button"
              onClick={reset}
              className="h-9 rounded-md border border-input px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
            <a
              href="/dashboard"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Go to dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
