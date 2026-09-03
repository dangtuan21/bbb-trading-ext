import { useMemo } from "react"
import DataTable from "./DataTable"
import PageHeader from "./PageHeader"
import { ACCOUNTLOG_COLUMNS } from "../lib/schema"
import { computeAccountLog } from "../lib/compute"
import { usePositionLog } from "../lib/usePositionLog"
import { useRelativeTime } from "../lib/relativeTime"

const SOURCE_FILE = "data/positions.csv"

/**
 * AccountLogPage: the Account Log tab -- header + ACCOUNTLOG_COLUMNS/
 * computeAccountLog(rows) straight into DataTable, no filter or per-row
 * styling of its own (unlike AccountViewPage/MarketViewPage). Fetches
 * positions.csv itself via usePositionLog() -- takes no props at all --
 * and computes its own account-log-shaped rows from it (computeAccountLog
 * is only ever used here, so there's no reason for App.jsx to fetch/
 * compute it up front and thread it down).
 *
 * The header's row count deliberately shows the raw positions.csv count
 * (`rows.length`) rather than the computed account-log rows' own count --
 * matches every other tab except Account View/Market View, which show
 * their OWN filtered count instead (see those pages' own PageHeader
 * usage).
 */
export default function AccountLogPage() {
  const { rows, status, error, updatedAt } = usePositionLog()
  const freshnessLabel = useRelativeTime(updatedAt)
  const accountLogRows = useMemo(() => computeAccountLog(rows), [rows])

  return (
    <>
      <PageHeader
        title="Account Log"
        status={status}
        error={error}
        sourceFile={SOURCE_FILE}
        freshnessLabel={freshnessLabel}
        rowCount={rows.length}
      />
      {status === "ready" && <DataTable columns={ACCOUNTLOG_COLUMNS} rows={accountLogRows} />}
    </>
  )
}
