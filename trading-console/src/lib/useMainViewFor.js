import { useMemo } from "react"
import { computeMainView } from "./compute"
import { matchRules } from "./matchRules"
import { hiddenAccounts } from "./hiddenAccounts"
import {
  useWarningDailyDrawdownThreshold,
  useWarningDrawdownThreshold,
  useWarningTargetProfitThreshold,
} from "./settings"

/**
 * useMainViewFor(rows): runs `rows` (already-fetched positions.csv or
 * market-positions.csv rows) through computeMainView() along with the
 * three drawdown/profit warning thresholds (matchRules/hiddenAccounts are
 * fixed app-wide config, not per-caller data). Factored out so both
 * useAccountView.js (positions.csv) and MarketViewPage.jsx (market-
 * positions.csv) share the exact same threshold-reading + compute wiring
 * instead of each duplicating it -- they're two different row sets run
 * through identical logic, not two different behaviors.
 */
export function useMainViewFor(rows) {
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
    [rows, warningDailyDrawdownPct, warningDrawdownPct, warningTargetProfitPct]
  )
}
