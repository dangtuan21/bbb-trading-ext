import { formatPct } from "../lib/compute"

/**
 * AccountChartPage: one horizontal bar per Account View row that currently
 * has an open position, showing that account's chart %, read off
 * `row[pctKey]` (App.jsx passes rows already filtered to A_Symbol !== "n/a"
 * and a numeric `row[pctKey]` -- see chartRows/dailyDdChartRows in App.jsx).
 * `pctKey` defaults to "A_PLPct" (the "Full Chart" section); passing
 * "A_TodayDrawdownPct" instead reuses this exact same component for the
 * "Daily DD Chart" section stacked right above it on the same "chart" nav
 * page (see the "chart" render branch in App.jsx), plotting "Cur Daily DD %"
 * per row instead -- everything below (scale, clipping, layout, ordering)
 * works identically no matter which field is plotted, since it's all keyed
 * off the single `pct` value read out of `pctKey`, not off A_PLPct
 * specifically.
 *
 * A shared vertical axis runs down the middle; a negative value grows LEFT
 * from the axis in red, a non-negative one grows RIGHT in green (unless
 * `growLeft` forces left regardless of sign -- see Daily DD Chart usage).
 * Bar length is |pct| read against a `scaleMax`%-wide scale (default 100,
 * so the Full Chart's A_PLPct keeps its original 0-100 behavior) --
 * `scaleMax`% is always full-width, half of `scaleMax` is always
 * half-width, NOT relative to whatever else happens to be on screen, so
 * the same % always looks the same regardless of what other rows/filter
 * are showing. A magnitude past `scaleMax` (a real possibility for
 * A_PLPct's drawdown-based reading once an account is underwater -- see
 * compute.js) just clips at the full-width edge rather than overflowing
 * the row.
 *
 * `scaleMaxKey`, when given, reads each ROW's own scale reference off
 * `row[scaleMaxKey]` instead of using the single fixed `scaleMax` for
 * every row -- e.g. the Daily DD Chart passes "A_MaxDailyDrawdownPct" so a
 * bar reaching full width means "at THIS account's actual daily loss
 * limit" (each platform reports its own, not always the same number
 * across accounts), rather than an arbitrary shared scale. Falls back to
 * the plain `scaleMax` prop (see useDailyDdChartScaleMax in settings.js,
 * default 5) for any row where that field is missing/blank/non-positive --
 * without either, real "Cur Daily DD %" values rarely exceed a few
 * percent, so at scaleMax=100 they'd all sit indistinguishably at the
 * 2%-floor sliver.
 *
 * Exactly 0% (isZero) is its own case, not just "a green sliver" -- there's
 * no real "which side" for a value that's neither up nor down, and a bar
 * there would just be visual noise at the minimum-width floor with nothing
 * behind it. So a 0% row draws no bar at all: plain text where the bar
 * would be (Symbol in slate, same position a green bar's white Symbol label
 * would sit), with the pct label still shown same as every other row --
 * the row stays on the chart (0% is still real information -- e.g. Daily DD
 * Chart's most common reading, an account that simply hasn't moved yet
 * today), it just doesn't draw a bar nobody can read anything from.
 *
 * An account with more than one open symbol at once still gets exactly one
 * bar (matches Account View's own row grain), using that account's single
 * pct value (it isn't tracked per-symbol). Its last 4 AccountID digits
 * (the full ID is already the AV/AL tabs' job, and a full RebelsFunding-
 * length ID would eat most of the bar) sit right next to the Symbol, on the
 * OTHER side of the axis from the bar -- i.e. in the half of the row the
 * bar doesn't occupy, hugging the axis so it reads as one unit with the
 * Symbol just across the line from it (e.g. a green bar growing right has
 * "4343" sitting just left of the axis, right beside "EURUSD" just right of
 * it). Same side as the bar the pct label is already on, at the far end.
 *
 * Order: green rows (pct >= 0) first, highest at the very top and
 * descending from there; red rows after, lowest (biggest loss) immediately
 * below the green block and ascending toward 0 at the very bottom -- so
 * both "how good is the best account" and "how bad is the worst account"
 * read off the two ends of the chart nearest the green/red boundary, not
 * one single top-to-bottom ranking across both colors.
 */
export default function AccountChartPage({ rows, pctKey = "A_PLPct", positiveColorClass = "bg-emerald-600", growLeft = false, scaleMax = 100, scaleMaxKey, warningKey }) {
  if (!rows.length) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 py-16 text-sm text-slate-400">
        No open positions to chart right now.
      </div>
    )
  }

  const values = rows.map((row) => ({ row, pct: parseFloat(row[pctKey]) }))
  const greens = values.filter((v) => v.pct >= 0).sort((a, b) => b.pct - a.pct)
  const reds = values.filter((v) => v.pct < 0).sort((a, b) => a.pct - b.pct)
  const sorted = [...greens, ...reds]

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {/* One shared scale reference for the whole chart (not repeated per
          row) -- lines up with the same w-9/flex-1/divider layout each row
          below uses, so it reads as an axis framing the bars rather than a
          separate caption. Uses the `scaleMax` prop directly (the Daily DD
          Chart's Settings-configured fallback, or 100 for the Full Chart)
          rather than any single row's own scaleMaxKey value, since this is
          one shared label for every row, not a per-row one anymore. */}
      <div className="mb-1.5 flex items-center gap-2 text-[10px] text-slate-400 tabular-nums">
        <span className="w-9 shrink-0 text-right">{scaleMax}%</span>
        <div className="flex-1" />
        <span className="w-px shrink-0" />
        <div className="flex-1" />
        <span className="w-9 shrink-0 text-left">{scaleMax}%</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {sorted.map(({ row, pct }) => {
          const isNegative = pct < 0
          const isZero = pct === 0
          // growLeft: force this bar onto the LEFT (red) side regardless of
          // sign -- used by the Daily DD Chart so it always reads red/left,
          // matching the Full Chart's red=left/green=right convention even
          // though a positive "Cur Daily DD %" isn't really a gain. Doesn't
          // touch isNegative itself (still drives the greens/reds sort
          // above and the isZero branch below).
          const barLeft = growLeft || isNegative
          // Per-row scale reference: prefer this row's own
          // row[scaleMaxKey] (e.g. its actual "Max Daily DD %") over the
          // flat `scaleMax` fallback, so a bar's full width means "at THIS
          // account's real limit" rather than one arbitrary shared number
          // -- see scaleMaxKey doc above.
          const rowScaleMaxRaw = scaleMaxKey ? parseFloat(row[scaleMaxKey]) : NaN
          const rowScaleMax = Number.isFinite(rowScaleMaxRaw) && rowScaleMaxRaw > 0 ? rowScaleMaxRaw : scaleMax
          // |pct| -> width% mapping against that scale: rowScaleMax% maps
          // to a full-width bar, so e.g. a 2.5% row against a 5% limit is
          // half-width instead of an indistinguishable 2%-floor sliver.
          // Still floored at 2% and clipped at 100% (a value past
          // rowScaleMax -- i.e. this account has breached its own daily
          // limit -- clips at the full-width edge same as before), and
          // still unused when isZero (no bar drawn at all then) --
          // harmless to compute.
          const widthPct = Math.min(Math.max((Math.abs(pct) / rowScaleMax) * 100, 2), 100)
          const last4 = row.A_AccountID ? String(row.A_AccountID).slice(-4) : ""
          const label = row.A_Symbol
          const pctLabel = formatPct(row[pctKey])
          // `warningKey` reads an already-computed boolean warning flag off
          // the row (A_DailyDrawdownWarning for the Daily DD Chart,
          // A_MaxDrawdownWarning for the Full Chart -- see compute.js and
          // their respective Settings thresholds) rather than re-deriving
          // a threshold check here. Blinks the bar itself (not the whole
          // row) so the red/green color coding stays intact -- it's an
          // added attention cue, not a replacement for it.
          const isWarning = warningKey ? Boolean(row[warningKey]) : false
          const barBlinkClass = isWarning ? " animate-chart-bar-blink" : ""

          return (
            <div key={`${row.A_Platform}|${row.A_AccountID}`} className="flex h-9 items-stretch">
              <div className="flex flex-1 items-center justify-end gap-2">
                {barLeft ? (
                  <>
                    <span className="shrink-0 text-xs tabular-nums text-slate-600">{pctLabel}</span>
                    <div
                      style={{ width: `${widthPct}%` }}
                      className={`flex h-6 min-w-8 items-center justify-end rounded-l bg-red-600 px-2${barBlinkClass}`}
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
                {!barLeft ? (
                  isZero ? (
                    <>
                      <span className="truncate pl-2 text-xs font-medium text-slate-500">{label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">{pctLabel}</span>
                    </>
                  ) : (
                    <>
                      <div
                        style={{ width: `${widthPct}%` }}
                        className={`flex h-6 min-w-8 items-center rounded-r ${positiveColorClass} px-2${barBlinkClass}`}
                      >
                        <span className="truncate text-xs font-medium text-white">{label}</span>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-slate-600">{pctLabel}</span>
                    </>
                  )
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
