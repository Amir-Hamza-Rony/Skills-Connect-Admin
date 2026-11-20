"use client"

import { useCallback, useState, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/dialog"

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "destructive" | "default"
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
}: ConfirmDialogProps) {
  const [confirming, setConfirming] = useState(false)

  const handleConfirm = useCallback(() => {
    setConfirming(true)
    Promise.resolve()
      .then(() => onConfirm())
      .finally(() => setConfirming(false))
  }, [onConfirm])

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <div className="flex flex-col gap-3">
        <AlertTriangle className="size-5 shrink-0 text-rose-400" aria-hidden />
        {confirming ? (
          <Button variant="outline" size="sm" disabled onClick={onClose}>
            {cancelLabel}
          </Button>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {cancelLabel}
            </Button>
            <Button
              variant={variant === "destructive" ? "destructive" : "default"}
              size="sm"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? "Confirming…" : confirmLabel}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
