import { useMemo } from "react"
import { computeMainView } from "./compute"
import { useConfigView } from "./useConfigView"
import {
  useWarningDailyDrawdownThreshold,
  useWarningDrawdownThreshold,
  useWarningTargetProfitThreshold,
} from "./settings"

/**
 * useMainViewFor(rows): runs `rows` (already-fetched positions.csv or
 * market-positions.csv rows) through computeMainView() along with the
 * three drawdown/profit warning thresholds and the live matchRules/
 * hiddenAccounts -- fetched at runtime via useConfigView(), not the old
 * build-time-only static JSON import (see useConfigView.js for why that
 * mattered). Factored out so both useAccountView.js (positions.csv) and
 * MarketViewPage.jsx (market-positions.csv) share the exact same
 * threshold-reading + compute wiring instead of each duplicating it --
 * they're two different row sets run through identical logic, not two
 * different behaviors.
 */
export function useMainViewFor(rows) {
  const { matchRules, hiddenAccounts } = useConfigView()
  const [warningDailyDrawdownPct] = useWarningDailyDrawdownThreshold()
  const [warningDrawdownPct] = useWarningDrawdownThreshold()
  const [warningTargetProfitPct] = useWarningTargetProfitThreshold()

  return useMemo(
    () =>
      computeMainView(
        rows,
        matchRules,
        warningDailyDrawdownPct,
        warningDrawdownPct,
        warningTargetProfitPct,
        hiddenAccounts
      ),
    [
      rows,
      matchRules,
      hiddenAccounts,
      warningDailyDrawdownPct,
      warningDrawdownPct,
      warningTargetProfitPct,
    ]
  )
}
