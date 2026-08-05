import { useMemo, useState } from "react"
import Sidebar from "./components/Sidebar"
import DataTable from "./components/DataTable"
import { usePositionLog } from "./lib/usePositionLog"
import { useRelativeTime } from "./lib/relativeTime"
import { computeAccountLog, computeMainView } from "./lib/compute"
import { matchRules } from "./lib/matchRules"
import { POSITIONLOG_FIELDS } from "./lib/schema"

const ACCOUNTLOG_COLUMNS = [
  "Platform",
  "AccountID",
  "AccountLabel",
  "Balance",
  "Equity",
  "AccountPL",
  "Symbol",
  "Direction",
  "TotalSize",
  "SymbolPL",
]

// MainView: each row pairs an A-side account (RebelsFunding/FTMO/
// AlphaCapital -- see A_SIDE_PLATFORMS in compute.js) with the matching
// B-side position from data-fact/config.json (B columns). A row with no
// rule, or whose rule's target isn't present in the current data, still
// shows -- the B_ columns are just left blank.
const MAINVIEW_COLUMNS = [
  { key: "A_Platform", label: "A Platform" },
  { key: "A_AccountID", label: "A Account ID" },
  { key: "A_Equity", label: "A Equity", money: true },
  { key: "A_AccountPL", label: "A Account PL", money: true },
  { key: "A_Symbol", label: "A Symbol" },
  { key: "A_Direction", label: "A Direction" },
  { key: "A_TotalSize", label: "A Size", numeric: true },
  { key: "A_PositionPL", label: "A P&L", money: true },
  { key: "B_SymbolPL", label: "B P&L", money: true },
  { key: "B_TotalSize", label: "B Size", numeric: true },
  { key: "B_Platform", label: "B Platform" },
  { key: "B_AccountID", label: "B Account ID" },
  { key: "B_Equity", label: "B Equity", money: true },
  { key: "B_AccountPL", label: "B Account PL", money: true },
  { key: "TP", label: "TP", numeric: true },
  { key: "SL", label: "SL", numeric: true },
]

export default function App() {
  const [active, setActive] = useState("positionlog")
  const { rows, status, error, updatedAt } = usePositionLog()
  const relativeUpdatedAt = useRelativeTime(updatedAt)

  const accountLogRows = useMemo(() => computeAccountLog(rows), [rows])
  const mainView = useMemo(() => computeMainView(rows, matchRules), [rows])

  return (
    <div className="flex h-screen w-screen bg-slate-100">
      <Sidebar active={active} onSelect={setActive} />

      <main className="flex-1 overflow-auto p-6">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-slate-800">{titleFor(active)}</h2>
          {status === "ready" && (
            <span className="text-xs text-slate-400">
              {rows.length} row{rows.length === 1 ? "" : "s"} · {relativeUpdatedAt ?? "data/*.csv"}
            </span>
          )}
        </header>

        {status === "loading" && (
          <p className="text-sm text-slate-400">Loading tastyfx.csv + rebelsfunding.csv...</p>
        )}

        {status === "error" && (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn't load the CSV data: {error}
          </p>
        )}

        {status === "ready" && active === "mainview" && (
          <DataTable
            columns={MAINVIEW_COLUMNS}
            rows={mainView.joined}
            emptyMessage="No RebelsFunding, FTMO, or AlphaCapital accounts in this snapshot yet."
          />
        )}

        {status === "ready" && active === "positionlog" && (
          <DataTable columns={POSITIONLOG_FIELDS} rows={rows} />
        )}

        {status === "ready" && active === "accountlog" && (
          <DataTable columns={ACCOUNTLOG_COLUMNS} rows={accountLogRows} />
        )}
      </main>
    </div>
  )
}

function titleFor(id) {
  switch (id) {
    case "accountlog":
      return "Account Log"
    case "mainview":
      return "Main View"
    default:
      return "Position Log"
  }
}
