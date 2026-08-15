import { useState } from "react"

const STORAGE_KEY = "alarmDailyDrawdownPct"
export const DEFAULT_ALARM_DAILY_DRAWDOWN_PCT = 20

function readStoredThreshold() {
  const raw = localStorage.getItem(STORAGE_KEY)
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ALARM_DAILY_DRAWDOWN_PCT
}

/**
 * MainView's Max/Today Drawdown highlight threshold. Persisted in
 * localStorage rather than config.json/ext-server -- this is a personal
 * display preference, not trading data, so it has no reason to be shared
 * across machines or go through the local write server.
 */
export function useAlarmThreshold() {
  const [threshold, setThreshold] = useState(readStoredThreshold)

  function updateThreshold(next) {
    setThreshold(next)
    localStorage.setItem(STORAGE_KEY, String(next))
  }

  return [threshold, updateThreshold]
}
