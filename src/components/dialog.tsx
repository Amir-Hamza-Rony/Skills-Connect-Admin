import { useEffect, type ReactNode } from "react"

/**
 * Minimal accessible dialog (shadcn-style, no extra dependency):
 * overlay click + Escape to close, initial focus on close button,
 * body scroll locked while open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-5 shadow-lg sm:p-6">
        <div className="flex items-start justify-between gap-3 pb-3">
          <div>
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            {description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            ref={(el) => el?.focus()}
            className="rounded-md p-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
