import { useMemo, useState } from "react"
import DataTable from "./DataTable"
import PageHeader from "./PageHeader"
import { useMainViewColumns } from "../lib/mainViewColumns"
import { useAccountView } from "../lib/useAccountView"

/**
 * AccountViewPage: the Account View tab -- header, Active/Inactive/All
 * filter, and DataTable. Pulled out of App.jsx's inline JSX purely for file
 * hygiene (App.jsx had grown past 600 lines) -- no behavior change from
 * what was inline before. Mirrors MarketViewPage.jsx, which is this same
 * shape plus a Refresh button/error banner Account View doesn't need
 * (Account View's positions.csv is scraped continuously by ext-server --
 * there's nothing to trigger by hand the way Market View's TwelveData
 * fetch needs a click).
 *
 * Fetches and computes its own data via useAccountView() -- the same
 * shared hook AccountChartsPage and RuleEditForm use (see that hook's own
 * comment) -- rather than App.jsx fetching/computing mainView once and
 * threading rows/status/error/freshness down as props. `mainView.joined`
 * is the FULL joined row set, UNFILTERED by the Active/Inactive/All radios
 * below (this page owns that filter state and the filtering itself, see
 * filter/filteredRows). Columns come from useMainViewColumns() -- Market
 * View reuses this exact same hook/column set (see lib/mainViewColumns.js).
 * `onRowClick` opens RuleEditForm for a row (App.jsx's setEditingRow) --
 * kept as a prop since App.jsx owns that modal's state (RuleEditForm is a
 * shared overlay, not something this page renders itself). rowBg (dimming
 * a no-open-position row to gray) needs nothing from App.jsx -- it's a pure
 * function of the row itself -- so it's hardcoded here instead of threaded
 * through as a prop.
 */
export default function AccountViewPage({ onRowClick }) {
  const { mainView, status, error, sourceFile, freshnessLabel } = useAccountView()
  const rows = mainView.joined
  const columns = useMainViewColumns()

  // "Active"/"Inactive"/"All" filter -- both Active and Inactive key off
  // the exact same test compute.js's hasOpenPosition and the rowBg
  // gray-dimming below already use (A_Symbol === "n/a"), so "empty A
  // Symbol" means one single thing everywhere rather than several slightly
  // different ones. Defaults to "active" since a no-position account is
  // exactly the kind of row rowBg already dims to gray as "nothing to see
  // here" -- Active just removes it instead of dimming it; Inactive is the
  // complement, for the opposite question ("which accounts have nothing
  // open right now"). Plain useState, not a persisted setting like the
  // warning thresholds -- a view filter, not account configuration.
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
        : "No RebelsFunding, FTMO, or AlphaCapital accounts in this snapshot yet."

  return (
    <>
      <PageHeader
        title="Account View"
        status={status}
        error={error}
        sourceFile={sourceFile}
        freshnessLabel={freshnessLabel}
        rowCount={filteredRows.length}
      />

      {status === "ready" && (
        <>
          <div className="mb-3 flex items-center gap-4 text-sm text-slate-600">
            <span className="font-medium">Filter:</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="mainview-filter" checked={filter === "active"} onChange={() => setFilter("active")} />
              Active
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="mainview-filter" checked={filter === "inactive"} onChange={() => setFilter("inactive")} />
              Inactive
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="mainview-filter" checked={filter === "all"} onChange={() => setFilter("all")} />
              All
            </label>
          </div>
          {/* rowBg dims a no-open-position account (A_Symbol is "n/a") to a
              flat light gray across the whole row -- same rows whose
              warnings are already suppressed in compute.js
              (hasOpenPosition), and the same rows the "Active" filter above
              removes entirely (or the ONLY rows "Inactive" keeps). Left in
              place (rather than dropped now that Active/Inactive can
              already narrow to one or the other) since "All" still shows a
              mix of both, and no-position rows should still read as
              "nothing to see here" there. */}
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
