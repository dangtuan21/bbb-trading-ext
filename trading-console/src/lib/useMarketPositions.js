import { useCallback, useEffect, useState } from "react"
import Papa from "papaparse"
import { POSITIONLOG_FIELDS } from "./schema"

// market-server writes market-positions.csv on demand now (POST /fetch --
// see market-server/server.js's runFetchCycle/startServer; the old fixed-
// interval polling loop was removed) and mirrors it here, same convention
// positions.csv/market.csv already use. Deliberately the exact same format
// as positions.csv itself (same columns, same one-row-per-position-or-per-
// empty-account shape, every platform -- RebelsFunding/FTMO/tastyfx
// positions get Latest/PositionPL/Equity refreshed from market-server's
// last fetch, everything else is copied through unchanged) so this hook
// reuses POSITIONLOG_FIELDS for cleanRow, and App.jsx can run the result
// through the exact same computeMainView() MainView itself uses, rather
// than a parallel data shape.
const MARKET_POSITIONS_URL = `${import.meta.env.BASE_URL}data/market-positions.csv`

// Distinct from ext-server's 8765 (RuleEditForm.jsx/SettingsPage.jsx's
// SERVER_URL) and trading-console's own dev-server 5173 -- see market-
// server/server.js's PORT.
const MARKET_SERVER_URL = import.meta.env.DEV ? "http://127.0.0.1:8766" : "/api/market"

// ext-server's own URL (same value RuleEditForm.jsx/SettingsPage.jsx use as
// SERVER_URL) -- refresh() below posts to its /notify/check once a market
// fetch succeeds, so "Alert Data Source: Market" (see SettingsPage) notices
// a threshold crossed by the fresh numbers. market-server has no way to
// call ext-server itself (two independent processes/ports), so this fire-
// and-forget call from the browser is what closes that loop.
const EXT_SERVER_URL = import.meta.env.DEV ? "http://127.0.0.1:8765" : "/api/ext"

function cleanRow(row) {
  const out = {}
  for (const field of POSITIONLOG_FIELDS) {
    out[field] = row[field] ?? ""
  }
  return out
}

async function loadMarketPositions() {
  const res = await fetch(MARKET_POSITIONS_URL)
  if (!res.ok) {
    // Missing file -- market-server hasn't been triggered yet (fresh
    // checkout, or nobody's clicked Refresh since) -- is a normal state,
    // not an error.
    if (res.status === 404) return { rows: [], lastModified: null }
    throw new Error(`Could not load ${MARKET_POSITIONS_URL} (${res.status})`)
  }
  // Same convention usePositionLog uses: the CSV's own Last-Modified header
  // (when market-server actually last wrote it), not whenever this tab
  // happened to fetch it.
  const header = res.headers.get("Last-Modified")
  const lastModified = header ? new Date(header) : new Date()
  const text = await res.text()
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false })
  return { rows: parsed.data.map(cleanRow), lastModified }
}

/**
 * Loads Market View rows from market-positions.csv on mount (whatever
 * market-server last wrote, if anything), and exposes `refresh()` to
 * trigger a brand new fetch on demand via market-server's POST /fetch --
 * this is now the ONLY way market-positions.csv gets updated; market-server
 * no longer polls TwelveData on a timer. A fetch can take over a minute
 * once TwelveData's per-minute chunking kicks in (see market-server's
 * CREDITS_PER_MINUTE_LIMIT/CHUNK_STAGGER_MS), so `refreshing` is exposed
 * separately from `status` -- App.jsx uses it to show a loading state on
 * the Refresh button without blanking the table that's already on screen.
 * On success, the rows/updatedAt come straight from POST /fetch's own
 * response body (it already has everything market-server just computed),
 * not a second GET of the CSV -- one round trip, not two. On failure, the
 * on-screen rows are left exactly as they were (stale, not wrong) and
 * `refreshError` is set for the UI to surface.
 */
export function useMarketPositions() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState("loading") // loading | ready | error
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(null)

  useEffect(() => {
    let cancelled = false

    loadMarketPositions()
      .then(({ rows, lastModified }) => {
        if (cancelled) return
        setRows(rows)
        setUpdatedAt(lastModified ?? new Date())
        setStatus("ready")
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setStatus("error")
      })

    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)

    // Distinguish "couldn't even reach market-server" (most likely cause:
    // it's just not running -- start.sh no longer keeps it polling in the
    // background on its own, so it's easy to forget to start) from "market-
    // server responded but the fetch cycle itself failed" (bad config.json,
    // TwelveData rate-limited/down) -- the fetch() call itself throwing is
    // the former; body.ok === false is the latter, and already carries its
    // own specific message from runFetchCycle, no guessing needed here.
    let res
    try {
      res = await fetch(`${MARKET_SERVER_URL}/fetch`, { method: "POST" })
    } catch {
      setRefreshError(`Could not reach market-server at ${MARKET_SERVER_URL} -- is it running? (see market-server/start.sh)`)
      setRefreshing(false)
      return
    }

    try {
      const body = await res.json()
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `market-server returned ${res.status}`)
      }
      setRows(body.marketPositions.map(cleanRow))
      setUpdatedAt(new Date(body.fetchedAt))
      setStatus("ready")
      // Fire-and-forget -- a failure here (e.g. ext-server not running
      // locally) shouldn't be surfaced as a failed market refresh; it just
      // means "Alert Data Source: Market" won't notice this particular
      // update until the next successful one. See EXT_SERVER_URL above.
      fetch(`${EXT_SERVER_URL}/notify/check`, { method: "POST" }).catch(() => {})
    } catch (err) {
      setRefreshError(err.message)
    } finally {
      setRefreshing(false)
    }
  }, [])

  return { rows, status, error, updatedAt, refresh, refreshing, refreshError }
}
