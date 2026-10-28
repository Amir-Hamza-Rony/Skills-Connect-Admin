"use client"
import { useEffect, useRef, useState } from "react"
import { Check, Monitor, Moon, Sun } from "lucide-react"

import { cn } from "@/lib/utils"
import { type ThemePreference, useTheme } from "@/lib/theme"

const OPTIONS: Array<{
  value: ThemePreference
  label: string
  icon: typeof Sun
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

/**
 * Compact dropdown Light / Dark / System switcher.
 * Single button in the header; options live inside the menu.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // The stored preference is only readable in the browser. Rendering the
  // neutral "System" icon until mount keeps server and client markup identical.
  useEffect(() => {
    setMounted(true)
  }, [])

  const ActiveIcon =
    (mounted && OPTIONS.find((o) => o.value === theme)?.icon) || Monitor

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open ])

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Appearance theme"
        title="Appearance theme"
        className="rounded-md p-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ActiveIcon className="size-5" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Appearance theme options"
          className="absolute right-0 z-50 mt-2 w-36 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = theme === value
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="flex-1 text-left">{label}</span>
                {active && <Check className="size-4" aria-hidden />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
