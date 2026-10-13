import { Component, type ReactNode } from "react"

/**
 * Last-resort error boundary: a crashed view degrades to a readable
 * error card with recovery instead of a blank page.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-background p-4">
          <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-card p-6 text-center">
            <h1 className="text-lg font-bold">Something went wrong</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This view hit an unexpected error. Your data entry elsewhere is
              unaffected.
            </p>
            <div className="flex justify-center gap-2 pt-4">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
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
        </div>
      )
    }
    return this.props.children
  }
}
