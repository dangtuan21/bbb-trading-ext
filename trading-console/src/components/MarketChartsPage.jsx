import { useMemo, useState } from "react"
import AccountChartPage from "./AccountChartPage"
import PageHeader from "./PageHeader"
import { useMarketView } from "../lib/useMarketView"
import { useDailyDdChartScaleMax } from "../lib/settings"

/**
 * MarketChartsPage: the "marketchart" nav item -- Daily DD Chart stacked on
 * top of Full Chart, one shared A&B/A-only Filter control above both.
 * Exactly AccountChartsPage.jsx's own structure (see its comment for the
 * full rationale on chartFilter/chartRows/dailyDdChartRows), just fed
 * useMarketView() instead of useAccountView() -- Market Chart reads from
 * the same source as Market View (market-positions.csv), the same way
 * Account Chart reads from the same source as Account View
 * (positions.csv). Kept as its own independent copy rather than factored
 * into one shared component with AccountChartsPage, matching how
 * AccountViewPage/MarketViewPage are also two independent pages rather
 * than a single parameterized one.
 *
 * Fetches and computes its own data via useMarketView() -- the same shared
 * hook MarketViewPage uses. Takes no props at all. `mainView.joined` is
 * Market View's full joined row set, UNFILTERED by whatever filter happens
 * to be set on the Market View tab itself -- this page derives its own two
 * row sets from it (see chartRows/dailyDdChartRows below). No row count in
 * the shared PageHeader (there are two different ones, shown per-section
 * instead) -- see PageHeader's own `rowCount` comment.
 *
 * Also surfaces the same Refresh button as Market View (see that page's
 * comment on why one exists at all -- market-server doesn't auto-poll
 * TwelveData). refresh/refreshing/refreshError come straight off this
 * page's own useMarketView() call above, same live state Market View's
 * button drives -- clicking Refresh here updates both tabs' data since
 * they share the same underlying market-positions.csv.
 */
export default function MarketChartsPage() {
  const [dailyDdChartScaleMax] = useDailyDdChartScaleMax()
  const { mainView, status, error, sourceFile, freshnessLabel, refresh, refreshing, refreshError } = useMarketView()
  const rows = mainView.joined
  // "A&B" (default) keeps only rows with a real B-side match (B_Platform
  // set -- see computeMainView's ruleTarget/r lookup: a row only gets B_*
  // fields when a matchRule paired it with an actual B-side position),
  // "A only" keeps just the opposite, rows with nothing on the B side. One
  // shared piece of state for BOTH charts on the page -- they're two views
  // of the same account set, so switching this should move both sections
  // together rather than each having its own independent filter.
  const [chartFilter, setChartFilter] = useState("both")

  // Full Chart's rows -- always Market View's OPEN-position accounts
  // (A_Symbol real, not "n/a"), regardless of whatever filter happens to be
  // set on the Market View tab itself; a flat account has no symbol to put
  // on a bar, so there's no "Inactive"/"All" equivalent here. Also drops
  // any row whose A_PLPct isn't a real number (e.g. no ProfitTarget scraped
  // yet) -- can't place it on the red/green axis at all. Then chartFilter
  // narrows further to A&B-matched rows or A-only rows.
  const chartRows = useMemo(() => {
    const base = rows.filter((row) => row.A_Symbol !== "n/a" && !Number.isNaN(parseFloat(row.A_PLPct)))
    if (chartFilter === "aonly") return base.filter((row) => !row.B_Platform)
    return base.filter((row) => row.B_Platform)
  }, [rows, chartFilter])

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
    if (chartFilter === "aonly") return base.filter((row) => !row.B_Platform)
    return base.filter((row) => row.B_Platform)
  }, [rows, chartFilter])

  return (
    <>
      <PageHeader
        title="Market Chart"
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
                name="market-chart-filter"
                checked={chartFilter === "both"}
                onChange={() => setChartFilter("both")}
              />
              A&amp;B
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="market-chart-filter"
                checked={chartFilter === "aonly"}
                onChange={() => setChartFilter("aonly")}
              />
              A only
            </label>
            {/* Same "no auto-poll, click here to fetch" button as Market
                View's own Refresh (see that page's comment) -- this page
                already calls useMarketView() itself, so refresh/refreshing/
                refreshError are the exact same live state Market View's
                button drives, not a separate copy. */}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {refreshing ? "Fetching..." : "Refresh"}
            </button>
          </div>
          {refreshError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Refresh failed: {refreshError}
            </p>
          )}

          <section>
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Daily DD Chart</h3>
            </div>
            <AccountChartPage rows={dailyDdChartRows} pctKey="A_TodayDrawdownPct" positiveColorClass="bg-red-600" growLeft scaleMax={dailyDdChartScaleMax} scaleMaxKey="A_MaxDailyDrawdownPct" warningKey="A_DailyDrawdownWarning" />
          </section>

          <section>
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Full Chart</h3>
            </div>
            <AccountChartPage rows={chartRows} warningKey="A_MaxDrawdownWarning" />
          </section>
        </div>
      )}
    </>
  )
}
