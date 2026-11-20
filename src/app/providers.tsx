"use client"

import type { ReactNode } from "react"

import { ErrorBoundary } from "@/components/error-boundary"
import { AuthProvider } from "@/lib/auth"
import { ThemeProvider } from "@/lib/theme"
import { ToastProvider } from "@/components/toast"

/** Global client providers, mounted once for the whole app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}
