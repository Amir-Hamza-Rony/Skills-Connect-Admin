import type { ReactNode } from "react"

export interface Column<T> {
  key: string
  label: string
  render?: (row: T) => ReactNode
}

/**
 * Consistent data-table pattern for every module: sticky header,
 * row hover, horizontal inner scroll (page never scrolls sideways),
 * empty state with guidance.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  emptyMessage,
  rowLabel,
}: {
  columns: Array<Column<T>>
  rows: T[]
  emptyMessage: string
  rowLabel?: (row: T) => string
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center">
        <p className="font-medium">No records found</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 bg-muted/60">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              aria-label={rowLabel?.(row)}
              className="border-t transition-colors first:border-t-0 hover:bg-muted/40"
            >
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3 align-middle">
                  {c.render
                    ? c.render(row)
                    : (row as unknown as Record<string, ReactNode>)[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
