import DataTable from "./DataTable"
import PageHeader from "./PageHeader"
import { POSITIONLOG_FIELDS } from "../lib/schema"
import { usePositionLog } from "../lib/usePositionLog"
import { useRelativeTime } from "../lib/relativeTime"

const SOURCE_FILE = "data/positions.csv"

/**
 * PositionLogPage: the Position Log tab -- header + POSITIONLOG_FIELDS/rows
 * straight into DataTable, no filter or per-row styling of its own (unlike
 * AccountViewPage/MarketViewPage). Fetches positions.csv itself via
 * usePositionLog() -- takes no props at all -- rather than App.jsx fetching
 * it once and threading rows/status/freshness down; every tab's rendering,
 * column config, data fetch, AND header lives in its own components/ file.
 */
export default function PositionLogPage() {
  const { rows, status, error, updatedAt } = usePositionLog()
  const freshnessLabel = useRelativeTime(updatedAt)

  return (
    <>
      <PageHeader
        title="Position Log"
        status={status}
        error={error}
        sourceFile={SOURCE_FILE}
        freshnessLabel={freshnessLabel}
        rowCount={rows.length}
      />
      {status === "ready" && <DataTable columns={POSITIONLOG_FIELDS} rows={rows} />}
    </>
  )
}
