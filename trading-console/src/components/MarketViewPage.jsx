import { useMemo, useState } from "react"
import DataTable from "./DataTable"
import PageHeader from "./PageHeader"
import { useMainViewColumns } from "../lib/mainViewColumns"
import { useMainViewFor } from "../lib/useMainViewFor"
import { useMarketPositions } from "../lib/useMarketPositions"
import { useRelativeTime } from "../lib/relativeTime"

const SOURCE_FILE = "data/market-positions.csv"

/**
 * MarketViewPage: the Market View tab -- header, Active/Inactive/All
 * filter, Refresh button, and DataTable. Pulled out of App.jsx's inline
 * JSX purely for file hygiene (App.jsx had grown past 600 lines) -- no
 * behavior change from what was inline before. Mirrors AccountViewPage.jsx
 * (see its own comment), plus the Refresh button and error banner Market
 * View alone needs -- market-server no longer polls TwelveData on its own,
 * so a click here is the only thing that triggers a fetch.
 *
 * Fetches and computes its own data: useMarketPositions() for market-
 * positions.csv (nothing else in the app reads it, so unlike positions.csv
 * -- see useAccountView.js -- there's no shared hook to reuse, just this
 * page calling it directly) run through useMainViewFor(), the same
 * threshold-reading + computeMainView() wiring useAccountView.js shares
 * with positions.csv. `marketMainView.joined` is the FULL joined row set,
 * UNFILTERED by the Active/Inactive/All radios below (this page owns that
 * filter state and the filtering itself, just like AccountViewPage's own).
 * Columns come from useMainViewColumns() -- Account View reuses this exact
 * same hook/column set (see lib/mainViewColumns.js). `onRowClick` opens
 * RuleEditForm the same way (App.jsx's setEditingRow, a shared overlay
 * this page doesn't render itself) -- the only prop this page still needs
 * from outside, since refresh/refreshing/refreshError all come straight
 * from this page's own useMarketPositions() call now. rowBg is hardcoded
 * here the same way as AccountViewPage, since it needs nothing from
 * App.jsx.
 */
export default function MarketViewPage({ onRowClick }) {
  const { rows: marketRows, status, error, updatedAt, refresh, refreshing, refreshError } = useMarketPositions()
  const freshnessLabel = useRelativeTime(updatedAt)
  const marketMainView = useMainViewFor(marketRows)
  const rows = marketMainView.joined
  const columns = useMainViewColumns()

  // Identical filter logic to AccountViewPage's own, just sourced from this
  // page's own marketMainView.joined instead of Account View's
  // mainView.joined. A separate piece of state (not shared with
  // AccountViewPage) since the two tabs are viewed independently --
  // switching one to "All" shouldn't silently change what the other shows.
  const [filter, setFilter] = useState("active")
  const filteredRows = useMemo(() => {
    if (filter === "active") return rows.filter((row) => row.A_Symbol !== "n/a")
    if (filter === "inactive") return rows.filter((row) => row.A_Symbol === "n/a")
    return rows
  }, [rows, filter])

  const emptyMessage =
    filter === "active"
      ? "No accounts with an open position right now -- switch to \"All\" to see every account."
      : filter === "inactive"
        ? "No accounts without an open position right now -- switch to \"All\" to see every account."
        : "No RebelsFunding, FTMO, or AlphaCapital accounts in market-positions.csv yet -- click Refresh to trigger a fetch (see market-server/start.sh)."

  return (
    <>
      <PageHeader
        title="Market View"
        status={status}
        error={error}
        sourceFile={SOURCE_FILE}
        freshnessLabel={freshnessLabel}
        rowCount={filteredRows.length}
      />

      {status === "ready" && (
        <>
          <div className="mb-3 flex items-center gap-4 text-sm text-slate-600">
            <span className="font-medium">Filter:</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="marketview-filter" checked={filter === "active"} onChange={() => setFilter("active")} />
              Active
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="marketview-filter" checked={filter === "inactive"} onChange={() => setFilter("inactive")} />
              Inactive
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="marketview-filter" checked={filter === "all"} onChange={() => setFilter("all")} />
              All
            </label>
            {/* market-server no longer polls TwelveData on its own -- this
                is the only thing that triggers a fetch. A round trip can
                take over a minute once TwelveData's per-minute chunking
                kicks in (see market-server's CREDITS_PER_MINUTE_LIMIT/
                CHUNK_STAGGER_MS), so the button disables and relabels
                itself instead of leaving the click with no feedback. */}
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
            <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Refresh failed: {refreshError}
            </p>
          )}
          {/* Same account-level shape as Account View (useMainViewColumns()
              reused as-is), just fed market-positions.csv's FX-estimated
              numbers. rowBg dims a no-open-position account the same way
              AccountViewPage's does. */}
          <DataTable
            columns={columns}
            rows={filteredRows}
            emptyMessage={emptyMessage}
            onRowClick={onRowClick}
            rowBg={(row) => (row.A_Symbol === "n/a" ? "bg-gray-400" : "")}
          />
        </>
      )}
    </>
  )
}
