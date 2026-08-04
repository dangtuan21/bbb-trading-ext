import { useMemo, useState } from "react"
import Sidebar from "./components/Sidebar"
import DataTable from "./components/DataTable"
import { usePositionLog } from "./lib/usePositionLog"
import { useRelativeTime } from "./lib/relativeTime"
import { computeAccountLog } from "./lib/compute"
import { POSITIONLOG_FIELDS } from "./lib/schema"

const ACCOUNTLOG_COLUMNS = [
  "Platform",
  "AccountID",
  "AccountLabel",
  "IsRealMoney",
  "Balance",
  "Equity",
  "AccountPL",
  "Symbol",
  "Direction",
  "TotalSize",
  "SymbolPL",
]

export default function App() {
  const [active, setActive] = useState("positionlog")
  const { rows, status, error, updatedAt } = usePositionLog()
  const relativeUpdatedAt = useRelativeTime(updatedAt)

  const accountLogRows = useMemo(() => computeAccountLog(rows), [rows])

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
    default:
      return "Position Log"
  }
}
