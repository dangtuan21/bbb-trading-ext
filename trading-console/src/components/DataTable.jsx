import { MONEY_FIELDS, NUMERIC_FIELDS } from "../lib/schema"
import { formatMoney, formatPct } from "../lib/compute"

// MainView's joined columns are prefixed "A_"/"B_" -- give each side's
// header cells a distinct background so the two blocks are visually easy
// to tell apart at a glance. Columns from other tables (PositionLog,
// AccountLog) have no such prefix and just keep the default header color.
const SIDE_HEADER_BG = { A: "bg-indigo-900", B: "bg-teal-900" }

function sideOf(key) {
  if (key.startsWith("A_")) return "A"
  if (key.startsWith("B_")) return "B"
  return null
}

/**
 * Generic table renderer. `columns` is an array where each entry is
 * either a plain field name (string) -- the original usage, where the
 * header label is derived by splitting camelCase (e.g. "AccountID" ->
 * "Account ID") and money-formatting is decided by schema.MONEY_FIELDS --
 * or a `{ key, label, money, numeric }` object for cases (like MainView's
 * joined left+right columns, which reuse prefixed keys like "A_TotalSize"
 * that aren't in MONEY_FIELDS/NUMERIC_FIELDS) where the row key, header
 * text, and money/numeric-formatting need to be set explicitly.
 *
 * `money` columns are formatted via formatMoney() and turn red when
 * negative. `numeric` columns (money columns are always numeric too) are
 * just right-aligned with tabular-nums, shown as-is otherwise -- for
 * columns like Size/TotalSize/Opening that are numbers but not currency.
 *
 * `highlightIf(row)` (optional) flags a cell for a warning background --
 * evaluated per row, so it can key off other fields on that same row (e.g.
 * MainView's Max/Today Drawdown cells, flagged together off a single
 * precomputed row.A_DailyDrawdownWarning rather than each column
 * re-deriving the ratio itself).
 *
 * `headerBg` (optional) overrides the header cell's default side-based
 * background (SIDE_HEADER_BG) -- for visually grouping a specific pair/set
 * of columns as related regardless of which side they're on, independent
 * of highlightIf's per-row warning state.
 *
 * `columnBg` (optional) tints every body cell in the column with a constant
 * background, all the time -- not conditional like highlightIf. When both
 * are set on the same column, a highlightIf-triggered cell uses a stronger
 * shade (bg-amber-200) instead of the baseline columnBg tint, so the
 * warning state still stands out above the column's own resting color.
 *
 * `link` (optional) renders that column's cell content as a clickable link
 * instead of plain text -- clicking it calls `onRowClick(row)`, same
 * callback a whole clickable row would use, just scoped to one column
 * (e.g. MainView's "A Account ID", which opens the edit-position modal)
 * instead of the entire row being clickable. Has no effect if `onRowClick`
 * isn't passed.
 *
 * `pct` (optional) formats the cell via formatPct() -- rounds to the
 * nearest whole number and appends "%" (e.g. 94.27 -> "94%"), for ratio
 * columns like MainView's "A Equity %". Independent of `money`/`numeric`;
 * a pct column should still set `numeric: true` for right-alignment.
 */
export default function DataTable({ columns, rows, emptyMessage = "No rows to show.", onRowClick }) {
  if (!rows.length) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 py-16 text-sm text-slate-400">
        {emptyMessage}
      </div>
    )
  }

  const cols = columns.map((col) => {
    const key = typeof col === "string" ? col : col.key
    const base = { key, label: splitCamel(key), money: MONEY_FIELDS.has(key) }
    const merged = typeof col === "string" ? base : { ...base, ...col }
    // `numeric` defaults off the FINAL money value (after any override),
    // not the base one -- a column explicitly marked money: true (e.g.
    // MainView's prefixed "A_PositionPL", which isn't itself a key in
    // MONEY_FIELDS) must still end up right-aligned even without also
    // repeating numeric: true by hand.
    const numeric = merged.numeric ?? (merged.money || NUMERIC_FIELDS.has(key))
    return { ...merged, numeric }
  })

  return (
    <div className="overflow-auto rounded-lg border border-slate-200 shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="sticky top-0 bg-slate-800 text-slate-100">
          <tr>
            {cols.map((col) => (
              <th
                key={col.key}
                className={`whitespace-nowrap px-3 py-2 text-xs font-semibold tracking-wide ${
                  col.numeric ? "text-right" : "text-left"
                } ${col.headerBg ?? SIDE_HEADER_BG[sideOf(col.key)] ?? ""}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {cols.map((col) => {
                const raw = row[col.key]
                const isNegative = col.money && parseFloat(raw) < 0
                const isHighlighted = col.highlightIf && col.highlightIf(row)
                const cellBg = isHighlighted ? "bg-amber-200" : col.columnBg ?? ""
                const content = col.money ? formatMoney(raw) : col.pct ? formatPct(raw) : raw
                return (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-3 py-2 ${
                      col.numeric ? "text-right tabular-nums" : "text-left"
                    } ${cellBg} ${isNegative ? "text-red-600" : "text-slate-700"}`}
                  >
                    {col.link && onRowClick ? (
                      <button
                        type="button"
                        onClick={() => onRowClick(row)}
                        className="text-indigo-600 underline decoration-dotted underline-offset-2 hover:text-indigo-800"
                      >
                        {content}
                      </button>
                    ) : (
                      content
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function splitCamel(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
}
