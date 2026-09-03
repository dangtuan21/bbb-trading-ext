import { usePositionLog } from "./usePositionLog"
import { useRelativeTime } from "./relativeTime"
import { useMainViewFor } from "./useMainViewFor"

const SOURCE_FILE = "data/positions.csv"

/**
 * useAccountView: positions.csv (usePositionLog) run through
 * useMainViewFor() -- the shared "Account-View-shaped" data every
 * component that reads A-side accounts joined against their B-side match
 * needs (AccountViewPage, AccountChartsPage, and RuleEditForm's bOptions
 * dropdown). Called independently by each of them rather than fetched/
 * computed once in App.jsx and threaded down as props -- only one tab is
 * ever mounted at a time, and RuleEditForm's own extra fetch/compute while
 * the modal is open is a one-time, cheap re-read of the same already-
 * loaded CSV, not a repeating cost.
 */
export function useAccountView() {
  const { rows, status, error, updatedAt } = usePositionLog()
  const freshnessLabel = useRelativeTime(updatedAt)
  const mainView = useMainViewFor(rows)

  return { rows, status, error, freshnessLabel, mainView, sourceFile: SOURCE_FILE }
}
