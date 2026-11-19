"use client"

import type { ReactNode } from "react"

type Datum = Record<string, any>

const PALETTE = ["#34d399", "#10b981", "#059669", "#a7f3d0", "#6ee7b7", "#047857", "#d1fae5", "#065f46"]

function compact(value: number): string {
  if (!Number.isFinite(value)) return "0"
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

export function ChartFrame({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      {caption && <p className="mt-0.5 text-xs text-slate-400">{caption}</p>}
      <div className="mt-4">{children}</div>
    </div>
  )
}

export function EmptyChart({ message = "No data for the selected filters." }: { message?: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-400">
      {message}
    </div>
  )
}

/** Horizontal bar chart. Values keep their exact label in a native tooltip. */
export function BarChart({
  data,
  labelKey,
  valueKey,
  caption,
}: {
  data: Datum[]
  labelKey: string
  valueKey: string
  caption?: string
}) {
  if (!data.length) return <EmptyChart />
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey] ?? 0)))
  return (
    <div className="space-y-2.5" role="img" aria-label={`${labelKey} by ${valueKey}`}>
      {data.slice(0, 10).map((d, i) => {
        const label = String(d[labelKey] ?? "Unknown")
        const value = Number(d[valueKey] ?? 0)
        return (
          <div key={`${label}-${i}`} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs" title={`${label}: ${value.toLocaleString()}`}>
            <span className="truncate text-slate-300">{label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-slate-800">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-500"
                style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
              />
            </span>
            <span className="tabular-nums text-slate-200">{compact(value)}</span>
          </div>
        )
      })}
      {caption && <p className="pt-1 text-[11px] text-slate-500">{caption}</p>}
    </div>
  )
}

/** SVG line + area chart with per-point tooltips. */
export function LineChart({
  data,
  labelKey = "month",
  valueKey = "count",
  seriesKey,
}: {
  data: Datum[]
  labelKey?: string
  valueKey?: string
  seriesKey?: string
}) {
  if (!data.length) return <EmptyChart />
  const width = 640
  const height = 200
  const padX = 36
  const padY = 24
  const values = data.map((d) => Number(d[valueKey] ?? 0))
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const points = data.map((d, i) => ({
    x: padX + (i * (width - padX * 2)) / Math.max(1, data.length - 1),
    y: height - padY - ((Number(d[valueKey] ?? 0) - min) / span) * (height - padY * 2),
    label: `${String(d[labelKey] ?? "")}${seriesKey ? ` · ${String(d[seriesKey])}` : ""}`,
    value: Number(d[valueKey] ?? 0),
  }))
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
  const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${height - padY} L ${points[0].x.toFixed(1)} ${height - padY} Z`
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label={`${valueKey} over time`}>
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padX} x2={width - padX} y1={padY + f * (height - padY * 2)} y2={padY + f * (height - padY * 2)} stroke="#1e293b" strokeWidth="1" />
      ))}
      <path d={area} fill="url(#areaFill)" />
      <path d={line} fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="#34d399" className="transition-all hover:r-6">
            <title>{`${p.label}: ${p.value.toLocaleString()}`}</title>
          </circle>
          {(i === 0 || i === points.length - 1 || points.length <= 6) && (
            <text x={p.x} y={height - 6} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {p.label.split(" · ")[0]}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

/** SVG donut with legend; segments expose exact counts via tooltips. */
export function DonutChart({
  data,
  labelKey = "label",
  valueKey = "count",
}: {
  data: Datum[]
  labelKey?: string
  valueKey?: string
}) {
  if (!data.length) return <EmptyChart />
  const total = data.reduce((s, d) => s + Number(d[valueKey] ?? 0), 0)
  if (total <= 0) return <EmptyChart message="All values are zero." />
  const radius = 62
  const circumference = 2 * Math.PI * radius
  // Build segments with precomputed cumulative offsets so no variable is
  // mutated during render (React fast-refresh / immutability rule).
  const slices = data.slice(0, 8).map((d) => Number(d[valueKey] ?? 0))
  const segments = slices.map((value, i) => {
    const length = (value / total) * circumference
    const drawn = Math.max(0, length - 2)
    return {
      value,
      dash: `${drawn} ${circumference - drawn}`,
      offset: slices.slice(0, i).reduce((sum, v) => sum + (v / total) * circumference, 0),
    }
  })
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0" role="img" aria-label="Distribution">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#1e293b" strokeWidth="18" />
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth="18"
            strokeDasharray={seg.dash}
            strokeDashoffset={-seg.offset}
            transform="rotate(-90 80 80)"
            className="transition-all duration-500 hover:opacity-80"
          >
            <title>{`${String(data[i][labelKey])}: ${seg.value.toLocaleString()} (${Math.round((seg.value / total) * 100)}%)`}</title>
          </circle>
        ))}
        <text x="80" y="76" textAnchor="middle" className="fill-slate-100 text-lg font-semibold">{compact(total)}</text>
        <text x="80" y="92" textAnchor="middle" className="fill-slate-500 text-[10px]">TOTAL</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {data.slice(0, 8).map((d, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-slate-300">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate">{String(d[labelKey])}</span>
            </span>
            <span className="tabular-nums text-slate-200">{compact(Number(d[valueKey] ?? 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
