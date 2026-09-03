import { formatPct } from "../lib/compute"

/**
 * Chart: one horizontal bar per Account View row that currently has an open
 * position, showing that account's A PL % (App.jsx passes rows already
 * filtered to A_Symbol !== "n/a" and a numeric A_PLPct -- see chartRows in
 * App.jsx). A shared vertical axis runs down the middle; a negative A PL%
 * grows LEFT from the axis in red, a non-negative one grows RIGHT in green
 * (0% renders as a green sliver on the right -- there's no real "which side"
 * for exactly zero, this just has to pick one). Bar length is |A_PLPct|
 * read directly against a fixed 0-100% scale -- a 50% row is always
 * half-width, a 100%-or-beyond row always reaches the panel edge -- NOT
 * relative to whatever else happens to be on screen, so the same % always
 * looks the same regardless of what other rows/filter are showing. A
 * magnitude past 100% (a real possibility for the drawdown-based reading
 * A_PLPct switches to once an account is underwater -- see compute.js)
 * just clips at the full-width edge rather than overflowing the row.
 *
 * An account with more than one open symbol at once still gets exactly one
 * bar (matches Account View's own row grain), using that account's single
 * A PL% value (it isn't tracked per-symbol). Its last 4 AccountID digits
 * (the full ID is already the AV/AL tabs' job, and a full RebelsFunding-
 * length ID would eat most of the bar) sit right next to the Symbol, on the
 * OTHER side of the axis from the bar -- i.e. in the half of the row the
 * bar doesn't occupy, hugging the axis so it reads as one unit with the
 * Symbol just across the line from it (e.g. a green bar growing right has
 * "4343" sitting just left of the axis, right beside "EURUSD" just right of
 * it). Same side as the bar the pct label is already on, at the far end.
 *
 * Order: green rows (A PL% >= 0) first, highest at the very top and
 * descending from there; red rows after, lowest (biggest loss) immediately
 * below the green block and ascending toward 0 at the very bottom -- so
 * both "how good is the best account" and "how bad is the worst account"
 * read off the two ends of the chart nearest the green/red boundary, not
 * one single top-to-bottom ranking across both colors.
 */
export default function ChartPage({ rows }) {
  if (!rows.length) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 py-16 text-sm text-slate-400">
        No open positions to chart right now.
      </div>
    )
  }

  const values = rows.map((row) => ({ row, pct: parseFloat(row.A_PLPct) }))
  const greens = values.filter((v) => v.pct >= 0).sort((a, b) => b.pct - a.pct)
  const reds = values.filter((v) => v.pct < 0).sort((a, b) => a.pct - b.pct)
  const sorted = [...greens, ...reds]

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1.5">
        {sorted.map(({ row, pct }) => {
          const isNegative = pct < 0
          // Direct |A_PLPct| -> width% mapping (50% = half the row, 100%+
          // clips at full width), floored so a near-zero mover still shows
          // a visible sliver instead of disappearing entirely.
          const widthPct = Math.min(Math.max(Math.abs(pct), 2), 100)
          const last4 = row.A_AccountID ? String(row.A_AccountID).slice(-4) : ""
          const label = row.A_Symbol
          const pctLabel = formatPct(row.A_PLPct)

          return (
            <div key={`${row.A_Platform}|${row.A_AccountID}`} className="flex h-9 items-stretch">
              <div className="flex flex-1 items-center justify-end gap-2">
                {isNegative ? (
                  <>
                    <span className="shrink-0 text-xs tabular-nums text-slate-600">{pctLabel}</span>
                    <div
                      style={{ width: `${widthPct}%` }}
                      className="flex h-6 min-w-8 items-center justify-end rounded-l bg-red-600 px-2"
                    >
                      <span className="truncate text-xs font-medium text-white">{label}</span>
                    </div>
                  </>
                ) : (
                  last4 && <span className="shrink-0 pr-2 text-xs font-medium text-slate-400">{last4}</span>
                )}
              </div>
              <div className="w-px shrink-0 self-stretch bg-slate-300" />
              <div className="flex flex-1 items-center gap-2">
                {!isNegative ? (
                  <>
                    <div
                      style={{ width: `${widthPct}%` }}
                      className="flex h-6 min-w-8 items-center rounded-r bg-emerald-600 px-2"
                    >
                      <span className="truncate text-xs font-medium text-white">{label}</span>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-slate-600">{pctLabel}</span>
                  </>
                ) : (
                  last4 && <span className="shrink-0 pl-2 text-xs font-medium text-slate-400">{last4}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
