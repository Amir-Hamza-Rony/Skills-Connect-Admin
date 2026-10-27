import { useEffect, useState, type FormEvent } from "react"
import { Bookmark, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createSavedView, deleteSavedView, listSavedViews } from "@/lib/queues"
import type { SavedView, SavedViewScope } from "@/lib/types"
import { cn } from "@/lib/utils"

/** A flat filter bag — keys depend on the scope (e.g. status, paymentStatus). */
export type ViewFilter = Record<string, string>

export interface PresetView {
  id: string
  name: string
  filter: ViewFilter
}

/**
 * Saved operational views (Spec §13). Renders the built-in queue presets as
 * one-click chips, the user's own saved views (apply + delete), and a control
 * to save the current filter as a named view.
 */
export function SavedViewsBar({
  scope,
  presets,
  current,
  onApply,
  className,
}: {
  scope: SavedViewScope
  presets: PresetView[]
  current: ViewFilter
  onApply: (filter: ViewFilter) => void
  className?: string
}) {
  const [saved, setSaved] = useState<SavedView[]>([])
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listSavedViews(scope).then(setSaved).catch(() => setSaved([]))
  }, [scope])

  function applyPreset(p: PresetView) {
    setActivePreset(p.id)
    onApply(p.filter)
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError("Give the view a name.")
      return
    }
    setError(null)
    setSaving(true)
    try {
      const created = await createSavedView({ name: name.trim(), scope, filters: current })
      setSaved((prev) => [...prev, created])
      setName("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save view.")
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(id: string) {
    await deleteSavedView(id).catch(() => undefined)
    setSaved((prev) => prev.filter((v) => v.id !== id))
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Queues
        </span>
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              activePreset === p.id
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      {(saved.length > 0 || saving) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Saved
          </span>
          {saved.map((v) => (
            <span
              key={v.id}
              className="group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
            >
              <button
                onClick={() => onApply(v.filters as ViewFilter)}
                className="font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                {v.name}
              </button>
              <button
                onClick={() => void onDelete(v.id)}
                aria-label={`Delete view ${v.name}`}
                className="text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={onSave} className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Save current view as…"
          aria-label="Saved view name"
          className="h-8 w-52 rounded-md border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" variant="outline" disabled={saving}>
          <Bookmark className="mr-1 size-3.5" />
          {saving ? "Saving…" : "Save view"}
        </Button>
        {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      </form>
    </div>
  )
}
