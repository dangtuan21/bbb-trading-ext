import { useMarketPositions } from "./useMarketPositions"
import { useRelativeTime } from "./relativeTime"
import { useMainViewFor } from "./useMainViewFor"

const SOURCE_FILE = "data/market-positions.csv"

/**
 * useMarketView: market-positions.csv (useMarketPositions) run through
 * useMainViewFor() -- the exact same shape as useAccountView.js, just fed
 * market-positions.csv instead of positions.csv. The shared "Market-View-
 * shaped" data every component that reads market-estimated A-side accounts
 * joined against their B-side match needs (MarketViewPage and
 * MarketChartsPage). Called independently by each of them rather than
 * fetched/computed once in App.jsx and threaded down as props -- only one
 * tab is ever mounted at a time, so there's no risk of the two drifting
 * out of sync with each other.
 */
export function useMarketView() {
  const { rows, status, error, updatedAt, refresh, refreshing, refreshError } = useMarketPositions()
  const freshnessLabel = useRelativeTime(updatedAt)
  const mainView = useMainViewFor(rows)

  return { rows, status, error, freshnessLabel, mainView, sourceFile: SOURCE_FILE, refresh, refreshing, refreshError }
}
