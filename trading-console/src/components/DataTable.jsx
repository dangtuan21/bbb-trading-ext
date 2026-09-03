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
 * are set on the same column, a highlightIf-triggered cell blinks (amber
 * animate-warn-blink, see index.css) instead of sitting on the baseline
 * columnBg tint, so the warning state still stands out above the column's
 * own resting color.
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
 *
 * `format(value)` (optional) -- a display-only transform applied to the
 * raw cell value (e.g. MainView's "A Platform" showing "RF" instead of
 * "RebelsFunding"). Only changes what's RENDERED; `row[col.key]` itself is
 * untouched, so matching/filtering logic elsewhere (A_SIDE_PLATFORMS,
 * matchRules, hiddenAccounts, the raw CSV) keeps working off the real
 * value. Takes precedence over money/pct when set, since a column needing
 * a custom display transform is never also a $ or % one.
 *
 * `width` (optional) -- a Tailwind min-width class (e.g. "min-w-[7rem]"),
 * applied to both the header and body cells of that column. Only needed
 * for a two-line label (`\n` in it, see below) whose second line is wider
 * than the column would otherwise render -- without it, whitespace-pre-line
 * still auto-wraps a too-wide line segment onto extra lines rather than
 * overflowing, so a label meant to be exactly two lines (e.g. MainView's
 * "A\nTarget Equity") can end up three or four. Plain single-line columns
 * size themselves from their content as before and don't need this.
 *
 * `rowBg(row)` (optional prop, not a column option) -- like `highlightIf`
 * but for the WHOLE row rather than one column: when it returns a
 * truthy Tailwind class, every cell in that row uses it instead of that
 * column's own `columnBg`/`highlightIf` state (e.g. MainView dims a
 * no-open-position row -- A_Symbol is "n/a" -- to a flat light gray so its
 * stale account-level numbers don't compete visually with rows that have
 * real positions open). Text switches to black whenever this fires.
 */
export default function DataTable({ columns, rows, emptyMessage = "No rows to show.", onRowClick, rowBg }) {
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
    // MainView's prefixed "A_AccountPL", which isn't itself a key in
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
                // A label containing "\n" (e.g. MainView's "Max Daily
                // DD"/"Cur Daily DD %" headers, split onto two lines to
                // keep those columns narrower) wraps at that literal break
                // via whitespace-pre-line instead of the default
                // whitespace-nowrap -- every other column's label has no
                // "\n" in it, so this only changes behavior for the ones
                // that opt in.
                className={`${col.label.includes("\n") ? "whitespace-pre-line" : "whitespace-nowrap"} px-3 py-2 text-xs font-semibold tracking-wide ${
                  col.numeric ? "text-right" : "text-left"
                } ${col.headerBg ?? SIDE_HEADER_BG[sideOf(col.key)] ?? ""} ${col.width ?? ""}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, i) => {
            const rowBackground = rowBg && rowBg(row)
            return (
            // A plain hover:bg-* on the <tr> barely shows in MainView --
            // almost every cell already paints its own background (a
            // column's columnBg tint, an animate-warn-blink highlight, or
            // rowBg's whole-row gray-400 override), which sits on the <td>
            // itself and covers whatever the <tr> underneath is doing.
            // hover:brightness-95 on the <tr> was tried first, but table
            // rows don't reliably apply `filter` across every cell in every
            // browser -- confirmed live, it only darkened some cells, not
            // the row as a whole. Fixed with an inset box-shadow instead,
            // applied per <td> (via group-hover, `group` on the <tr>): a
            // shadow always paints on top of that cell's own
            // background-color, so "9999px" of slate at 6% opacity reads as
            // a uniform darken no matter what color/highlight state sits
            // underneath -- reliable per-cell rather than hoping one
            // filtered box covers every cell inside it.
            <tr key={i} className="group">
              {cols.map((col) => {
                const raw = row[col.key]
                const isNegative = col.money && parseFloat(raw) < 0
                const isHighlighted = col.highlightIf && col.highlightIf(row)
                const cellBg = rowBackground || (isHighlighted ? "animate-warn-blink" : col.columnBg ?? "")
                const content = col.format ? col.format(raw) : col.money ? formatMoney(raw) : col.pct ? formatPct(raw) : raw
                return (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-3 py-2 transition-shadow duration-100 group-hover:shadow-[inset_0_0_0_9999px_rgba(15,23,42,0.06)] ${col.width ?? ""} ${
                      col.numeric ? "text-right tabular-nums" : "text-left"
                    } ${cellBg} ${
                      rowBackground ? "text-black" : isNegative ? "text-red-600" : "text-slate-700"
                    }`}
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
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function splitCamel(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
}
