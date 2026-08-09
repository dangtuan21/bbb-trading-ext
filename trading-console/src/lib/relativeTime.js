import { useEffect, useState } from "react"

/**
 * "10 mins ago"-style formatting for a Date. Deliberately coarse (minutes/
 * hours/days, no seconds) since this is a "how fresh is this data" label,
 * not a precise timer.
 */
export function formatRelativeTime(date) {
  if (!date) return null
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.max(0, Math.floor(diffMs / 1000))

  if (diffSec < 60) return "just now"

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`

  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

/**
 * Live-updating version of formatRelativeTime -- usePositionLog only
 * fetches once on mount, so without a ticking re-render the label would
 * freeze at whatever it said the moment the page first loaded (e.g.
 * stuck at "just now" for as long as the tab stays open). Re-renders
 * every `intervalMs` so it keeps climbing ("1min ago" -> "2mins ago" ->
 * ...) while you're looking at it.
 */
export function useRelativeTime(date, intervalMs = 30000) {
  const [, forceRerender] = useState(0)

  useEffect(() => {
    if (!date) return
    const id = setInterval(() => forceRerender((n) => n + 1), intervalMs)
    return () => clearInterval(id)
  }, [date, intervalMs])

  return formatRelativeTime(date)
}
