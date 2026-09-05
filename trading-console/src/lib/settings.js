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

// "TP/SL" column empty-cell warning -- On/Off, not a threshold, so it gets
// its own boolean-flavored storage key/default rather than reusing
// TARGET_PROFIT_STORAGE_KEY's numeric shape.
const TPSL_STORAGE_KEY = "warningTPSLEnabled"
export const DEFAULT_WARNING_TPSL_ENABLED = true

// Daily DD Chart's bar-scale FALLBACK -- AccountChartPage prefers each
// row's own actual "Max Daily DD %" (scaleMaxKey="A_MaxDailyDrawdownPct",
// scraped per-account/platform) as the |pct| value that fills a bar to
// 100% width, so a full-width bar means "at that account's real daily
// loss limit". This setting only kicks in for a row missing that field
// (blank/non-positive). Default 5% since that's the common value seen in
// practice, but tune here if your accounts mostly run a different limit.
// Purely a display preference (same localStorage-only persistence as the
// warning thresholds above), not itself tied to any platform's rule.
const DAILY_DD_CHART_SCALE_STORAGE_KEY = "dailyDdChartScaleMaxPct"
export const DEFAULT_DAILY_DD_CHART_SCALE_MAX_PCT = 5

function readStoredThreshold(storageKey, fallback) {
  const raw = localStorage.getItem(storageKey)
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function readStoredBoolean(storageKey, fallback) {
  const raw = localStorage.getItem(storageKey)
  return raw === null ? fallback : raw === "true"
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

/**
 * MainView's "TP/SL" column highlight -- On/Off (not a threshold): when on,
 * a row whose account has no open position with a Take Profit or Stop Loss
 * set (A_TPSL === "") gets flagged for the same amber warning background as
 * the threshold-driven columns. Same localStorage persistence as the
 * threshold settings above, just a boolean instead of a number.
 */
export function useWarningTPSLEnabled() {
  const [enabled, setEnabled] = useState(() =>
    readStoredBoolean(TPSL_STORAGE_KEY, DEFAULT_WARNING_TPSL_ENABLED)
  )

  function updateEnabled(next) {
    setEnabled(next)
    localStorage.setItem(TPSL_STORAGE_KEY, String(next))
  }

  return [enabled, updateEnabled]
}

/**
 * Daily DD Chart's bar-scale reference (see DAILY_DD_CHART_SCALE_STORAGE_KEY
 * above) -- same shape/persistence as the warning thresholds, just not a
 * warning itself.
 */
export function useDailyDdChartScaleMax() {
  const [scaleMax, setScaleMax] = useState(() =>
    readStoredThreshold(DAILY_DD_CHART_SCALE_STORAGE_KEY, DEFAULT_DAILY_DD_CHART_SCALE_MAX_PCT)
  )

  function updateScaleMax(next) {
    setScaleMax(next)
    localStorage.setItem(DAILY_DD_CHART_SCALE_STORAGE_KEY, String(next))
  }

  return [scaleMax, updateScaleMax]
}
