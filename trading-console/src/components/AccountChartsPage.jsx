import { useMemo, useState } from "react"
import AccountChartPage from "./AccountChartPage"
import PageHeader from "./PageHeader"
import { useAccountView } from "../lib/useAccountView"
import { useDailyDdChartScaleMax, useOverWeekend } from "../lib/settings"

/**
 * AccountChartsPage: the "chart" nav item -- Daily DD Chart stacked on top
 * of Full Chart, one shared A&B/A-only Filter control above both. Pulled
 * out of App.jsx's inline JSX (it was the one tab never extracted into its
 * own component, unlike every other page) purely for file hygiene -- no
 * behavior change from what was inline before.
 *
 * Fetches and computes its own data via useAccountView() -- the same
 * shared hook AccountViewPage and RuleEditForm use (see that hook's own
 * comment) -- rather than App.jsx fetching/computing mainView once and
 * threading rows/status/error/freshness down as props. Takes no props at
 * all. `mainView.joined` is Account View's full joined row set, UNFILTERED
 * by whatever filter happens to be set on the Account View tab itself --
 * this page derives its own two row sets from it (see chartRows/
 * dailyDdChartRows below). No row count in the shared PageHeader (there
 * are two different ones, shown per-section instead) -- see PageHeader's
 * own `rowCount` comment.
 */

// A_Platform -> the short RF/FTMO/AC key useOverWeekend()/useMinTrades()
// store settings under -- same mapping AccountChartPage.jsx keeps its own
// copy of for the same reason (see that file's minTradesKeyForPlatform).
function overWeekendKeyForPlatform(platform) {
  if (platform === "RebelsFunding") return "RF"
  if (platform === "FTMO") return "FTMO"
  if (platform === "AlphaCapital") return "AC"
  return null
}

export default function AccountChartsPage() {
  const [dailyDdChartScaleMax] = useDailyDdChartScaleMax()
  const [overWeekend] = useOverWeekend()
  const { mainView, status, error, sourceFile, freshnessLabel } = useAccountView()
  const rows = mainView.joined
  // Friday + that account's platform has Over Weekend set to Off --
  // evaluated once per render off the real wall clock (not from any CSV
  // field), so it naturally flips on/off as the week turns without a
  // capture even having to run. getDay()===5 is Friday regardless of
  // locale/timezone setting on this machine.
  const isFriday = new Date().getDay() === 5
  // "A&B" (default) keeps only rows with a real B-side match (B_Platform
  // set -- see computeMainView's ruleTarget/r lookup: a row only gets B_*
  // fields when a matchRule paired it with an actual B-side position),
  // "A only" keeps just the opposite, rows with nothing on the B side. One
  // shared piece of state for BOTH charts on the page -- they're two views
  // of the same account set, so switching this should move both sections
  // together rather than each having its own independent filter (that was
  // tried and reverted -- see chartRows/dailyDdChartRows below, both keyed
  // off this same chartFilter).
  const [chartFilter, setChartFilter] = useState("all")

  // Full Chart's rows -- always Account View's OPEN-position accounts
  // (A_Symbol real, not "n/a"), regardless of whatever filter happens to be
  // set on the Account View tab itself; a flat account has no symbol to put
  // on a bar, so there's no "Inactive"/"All" equivalent here. Also drops
  // any row whose A_PLPct isn't a real number (e.g. no ProfitTarget scraped
  // yet) -- can't place it on the red/green axis at all. Then chartFilter
  // narrows further to A&B-matched rows or A-only rows.
  const chartRows = useMemo(() => {
    const base = rows.filter((row) => row.A_Symbol !== "n/a" && !Number.isNaN(parseFloat(row.A_PLPct)))
    const matched =
      chartFilter === "all" ? base
      : chartFilter === "aonly" ? base.filter((row) => !row.B_Platform)
      : base.filter((row) => row.B_Platform)
    // A_OverWeekendWarning: an open position, on Friday, on a platform
    // whose Over Weekend setting is explicitly Off (Settings page) -- read
    // by AccountChartPage's extraWarningKey to blink the bar as a "close
    // this before the weekend" reminder. Platforms Over Weekend doesn't
    // cover (overWeekendKeyForPlatform returns null) never warn.
    return matched.map((row) => {
      const key = overWeekendKeyForPlatform(row.A_Platform)
      return { ...row, A_OverWeekendWarning: isFriday && key !== null && overWeekend[key] === false }
    })
  }, [rows, chartFilter, isFriday, overWeekend])

  // Daily DD Chart -- same nav grouping as Full Chart (stacked right above
  // it) and reuses the exact same AccountChartPage component, just plotting
  // A_TodayDrawdownPct ("Cur Daily DD %") instead of A_PLPct -- see
  // AccountChartPage's pctKey prop. Shares chartFilter with Full Chart
  // (see above) rather than having its own filter state. A 0% row still
  // shows (most accounts haven't moved on their daily drawdown yet at any
  // given snapshot, and that's real information too, not a reason to hide
  // the row) -- AccountChartPage just skips drawing a bar for it, see its
  // own isZero handling.
  const dailyDdChartRows = useMemo(() => {
    const base = rows.filter((row) => row.A_Symbol !== "n/a" && !Number.isNaN(parseFloat(row.A_TodayDrawdownPct)))
    const matched =
      chartFilter === "all" ? base
      : chartFilter === "aonly" ? base.filter((row) => !row.B_Platform)
      : base.filter((row) => row.B_Platform)
    // Same A_OverWeekendWarning annotation as chartRows above (see its
    // comment) -- shared here too since Daily DD Chart's bars should blink
    // for the same Friday/Over-Weekend-Off reason.
    return matched.map((row) => {
      const key = overWeekendKeyForPlatform(row.A_Platform)
      return { ...row, A_OverWeekendWarning: isFriday && key !== null && overWeekend[key] === false }
    })
  }, [rows, chartFilter, isFriday, overWeekend])

  return (
    <>
      <PageHeader
        title="Account Chart"
        status={status}
        error={error}
        sourceFile={sourceFile}
        freshnessLabel={freshnessLabel}
      />

      {status === "ready" && (
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <span className="font-medium">Filter:</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="chart-filter"
                checked={chartFilter === "all"}
                onChange={() => setChartFilter("all")}
              />
              All
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="chart-filter"
                checked={chartFilter === "both"}
                onChange={() => setChartFilter("both")}
              />
              A&amp;B
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="chart-filter"
                checked={chartFilter === "aonly"}
                onChange={() => setChartFilter("aonly")}
              />
              A only
            </label>
          </div>

          <section>
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Daily DD Chart</h3>
            </div>
            <AccountChartPage rows={dailyDdChartRows} pctKey="A_TodayDrawdownPct" positiveColorClass="bg-red-600" growLeft scaleMax={dailyDdChartScaleMax} scaleMaxKey="A_MaxDailyDrawdownPct" warningKey="A_DailyDrawdownWarning" extraWarningKey="A_OverWeekendWarning" noSlKey="A_TPSL" />
          </section>

          <section>
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Full Chart</h3>
            </div>
            <AccountChartPage rows={chartRows} warningKey="A_MaxDrawdownWarning" extraWarningKey="A_OverWeekendWarning" />
          </section>
        </div>
      )}
    </>
  )
}
