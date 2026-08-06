import { useEffect, useState } from "react"
import Papa from "papaparse"
import { POSITIONLOG_FIELDS } from "./schema"

// ext-server merges every platform's rows into one combined CSV (see
// server.js's platformRows cache + writeCombined) and mirrors it here.
const POSITIONS_URL = `${import.meta.env.BASE_URL}data/positions.csv`

function cleanRow(row) {
  const out = {}
  for (const field of POSITIONLOG_FIELDS) {
    out[field] = row[field] ?? ""
  }
  return out
}

async function loadPositions() {
  const res = await fetch(POSITIONS_URL)
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

    loadPositions()
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

  return { rows, status, error, updatedAt }
}
