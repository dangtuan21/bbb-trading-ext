import { useEffect, useState } from "react"
import Papa from "papaparse"
import { POSITIONLOG_FIELDS } from "./schema"

// ext-server merges every platform's rows into one combined CSV (see
// server.js's platformRows cache + writeCombined) and mirrors it here.
const POSITIONS_URL = `${import.meta.env.BASE_URL}data/positions.csv`

// positions.csv changes passively, in the background, whenever any
// extension's own timer (or its "Write Now" button) fires -- unlike
// market-positions.csv, which only ever updates from an explicit user
// click (see useMarketPositions.js's refresh()). Nothing in THIS tab
// drives those writes, so this hook has to poll rather than fetch once on
// mount, or every screen built on it (MainView, AccountView/Chart,
// RuleEditForm's "Match B-position" dropdown) keeps showing whatever was
// true whenever the tab happened to load -- confirmed live 2026-09-29:
// after a tastyfx fix started correctly clearing a stale position server-
// side, the already-open RuleEditForm dropdown kept offering it as a
// match target, because this hook had only ever fetched once, at mount.
const POLL_INTERVAL_MS = 30_000

function cleanRow(row) {
  const out = {}
  for (const field of POSITIONLOG_FIELDS) {
    out[field] = row[field] ?? ""
  }
  return out
}

async function loadPositions() {
  // cache: 'no-store' -- same fix as useMarketPositions.js's loadMarketPositions
  // (see its comment): without this, a browser can serve this GET from its
  // own HTTP cache on reload instead of asking the server, showing a stale
  // freshness label even though positions.csv was written more recently.
  const res = await fetch(POSITIONS_URL, { cache: 'no-store' })
  if (!res.ok) {
    // Missing file (e.g. no extension has written yet) is a normal state,
    // not an error -- it just means 0 rows rather than blocking the page.
    if (res.status === 404) return { rows: [], lastModified: null }
    throw new Error(`Could not load ${POSITIONS_URL} (${res.status})`)
  }
  // When the CSV file itself was last written by the extension's server
  // (not when this tab happened to fetch it) -- read off the HTTP
  // Last-Modified header, which static file servers set from the file's
  // mtime.
  const header = res.headers.get("Last-Modified")
  const lastModified = header ? new Date(header) : new Date()
  const text = await res.text()
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false })
  return { rows: parsed.data.map(cleanRow), lastModified }
}

/**
 * Loads PositionLog rows from the combined positions.csv. `updatedAt`
 * reflects the file's Last-Modified header, i.e. whenever ext-server last
 * wrote it (from any platform), so the header always shows the freshest
 * data's age.
 */
export function usePositionLog() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState("loading") // loading | ready | error
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    // Plain closure variable, not React state -- this runs inside an
    // effect that only ever sets up once ([] deps), so a `status` state
    // value read in here would be permanently stuck at whatever it was on
    // mount ("loading"), never seeing later renders' "ready". This avoids
    // that stale-closure trap entirely.
    let hasLoadedOnce = false

    function refresh() {
      loadPositions()
        .then(({ rows, lastModified }) => {
          if (cancelled) return
          setRows(rows)
          setUpdatedAt(lastModified ?? new Date())
          setStatus("ready")
          hasLoadedOnce = true
        })
        .catch((err) => {
          if (cancelled) return
          // Only the very first load failing should surface an error
          // state and blank the page -- a later poll failing (ext-server
          // briefly restarting, a network blip) shouldn't wipe out data
          // that's already on screen; just keep showing it, slightly
          // stale, until the next poll succeeds.
          if (!hasLoadedOnce) {
            setError(err.message)
            setStatus("error")
          }
        })
    }

    refresh()
    const intervalId = setInterval(refresh, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [])

  return { rows, status, error, updatedAt }
}
