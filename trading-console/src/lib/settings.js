import { useState } from "react"

// Kept as the original literal ("alarm...") even though the UI label is now
// "Warning Daily Drawdown %" -- renaming the storage key itself would reset
// anyone's already-saved threshold back to the default for no real benefit.
const DAILY_STORAGE_KEY = "alarmDailyDrawdownPct"
export const DEFAULT_WARNING_DAILY_DRAWDOWN_PCT = 20

// Contest-wide Max Drawdown / Current Value warning threshold -- separate
// setting/storage key from the daily one above, since they flag different
// column pairs (Max DD/Cur DD vs Max Daily DD/Cur Daily DD) and a user may
// want different sensitivity for each.
const DRAWDOWN_STORAGE_KEY = "warningDrawdownPct"
export const DEFAULT_WARNING_DRAWDOWN_PCT = 20

// "A Target PL"/"A Account PL" progress-toward-target warning threshold --
// flags once current profit (AccountPL) reaches this % of the account's
// Profit Target, an early heads-up that the account is closing in on
// passing its challenge.
const TARGET_PROFIT_STORAGE_KEY = "warningTargetProfitPct"
export const DEFAULT_WARNING_TARGET_PROFIT_PCT = 80

function readStoredThreshold(storageKey, fallback) {
  const raw = localStorage.getItem(storageKey)
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * MainView's Max Daily Drawdown / Cur Daily Drawdown highlight threshold.
 * Persisted in localStorage rather than config.json/ext-server -- this is a
 * personal display preference, not trading data, so it has no reason to be
 * shared across machines or go through the local write server.
 */
export function useWarningDailyDrawdownThreshold() {
  const [threshold, setThreshold] = useState(() =>
    readStoredThreshold(DAILY_STORAGE_KEY, DEFAULT_WARNING_DAILY_DRAWDOWN_PCT)
  )

  function updateThreshold(next) {
    setThreshold(next)
    localStorage.setItem(DAILY_STORAGE_KEY, String(next))
  }

  return [threshold, updateThreshold]
}

/**
 * MainView's contest-wide Max Drawdown / Cur Drawdown ("Max DD"/"Cur DD"
 * columns) highlight threshold -- same shape/persistence as the daily one
 * above, just a distinct setting so each column pair can be tuned
 * independently.
 */
export function useWarningDrawdownThreshold() {
  const [threshold, setThreshold] = useState(() =>
    readStoredThreshold(DRAWDOWN_STORAGE_KEY, DEFAULT_WARNING_DRAWDOWN_PCT)
  )

  function updateThreshold(next) {
    setThreshold(next)
    localStorage.setItem(DRAWDOWN_STORAGE_KEY, String(next))
  }

  return [threshold, updateThreshold]
}

/**
 * MainView's "A Target PL"/"A Account PL" highlight threshold -- same
 * shape/persistence as the other two above, just a distinct setting so it
 * can be tuned independently.
 */
export function useWarningTargetProfitThreshold() {
  const [threshold, setThreshold] = useState(() =>
    readStoredThreshold(TARGET_PROFIT_STORAGE_KEY, DEFAULT_WARNING_TARGET_PROFIT_PCT)
  )

  function updateThreshold(next) {
    setThreshold(next)
    localStorage.setItem(TARGET_PROFIT_STORAGE_KEY, String(next))
  }

  return [threshold, updateThreshold]
}
