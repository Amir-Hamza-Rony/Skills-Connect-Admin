"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { X, AlertTriangle, CheckCircle, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type ToastVariant = "default" | "destructive" | "success" | "info" | "warning"

export interface Toast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  duration?: number
  action?: ReactNode
}

const VARIANT_ICON: Record<ToastVariant, React.ElementType> = {
  default: Info,
  destructive: AlertTriangle,
  success: CheckCircle,
  info: Info,
  warning: AlertTriangle,
}

const VARIANT_CLASS: Record<ToastVariant, string> = {
  default: "border-slate-700 bg-slate-900 text-slate-100",
  destructive: "border-rose-500/30 bg-rose-900/30 text-rose-300",
  success: "border-emerald-500/30 bg-emerald-900/30 text-emerald-300",
  info: "border-slate-700 bg-slate-900 text-slate-100",
  warning: "border-amber-500/30 bg-amber-900/30 text-amber-300",
}

export function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = VARIANT_ICON[toast.variant]
  return (
    <Card className={cn("border border-slate-800 rounded-lg p-4 shadow-lg", VARIANT_CLASS[toast.variant])} role="status" aria-label={toast.title}>
      <CardHeader className="flex flex-row items-center gap-3 py-0">
        <Icon className="size-5 shrink-0" aria-hidden />
        <div className="flex-1">
          <CardTitle className="text-sm font-medium leading-none">{toast.title}</CardTitle>
          {toast.description && (
            <CardDescription className="text-xs text-muted-foreground">{toast.description}</CardDescription>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          className="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </CardHeader>
      {toast.action && <CardFooter className="mt-3">{toast.action}</CardFooter>}
    </Card>
  )
}

interface ToastProviderProps {
  children: React.ReactNode
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, "id">) => string
  dismissToast: (id: string) => void
  clearToasts: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setToasts((prev) => [...prev, { ...toast, id }])
      if (toast.duration ?? true) {
        const ms = toast.duration ?? 5000
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, ms)
      }
      return id
    },
    [],
  )

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const clearToasts = useCallback(() => {
    setToasts([])
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, addToast, dismissToast, clearToasts }),
    [toasts, addToast, dismissToast, clearToasts],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full max-w-xs">
            <ToastItem toast={t} onDismiss={() => dismissToast(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return ctx
}
