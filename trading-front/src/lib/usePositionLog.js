import { useEffect, useState } from "react"
import Papa from "papaparse"
import { POSITIONLOG_FIELDS } from "./schema"

// Each platform's local server (ext-server) mirrors its own CSV here --
// merged client-side rather than server-side so one platform's write can
// never clobber another's (see ext-server/server.js's mirrorToFrontend).
const SOURCES = [
  { platform: "tastyfx", url: `${import.meta.env.BASE_URL}data/tastyfx.csv` },
  { platform: "rebelsfunding", url: `${import.meta.env.BASE_URL}data/rebelsfunding.csv` },
  { platform: "ftmo", url: `${import.meta.env.BASE_URL}data/ftmo.csv` },
]

function cleanRow(row) {
  const out = {}
  for (const field of POSITIONLOG_FIELDS) {
    out[field] = row[field] ?? ""
  }
  return out
}

async function loadSource({ url }) {
  const res = await fetch(url)
  if (!res.ok) {
    // Missing file (e.g. that extension hasn't written yet) is a normal
    // state, not an error -- it just contributes 0 rows rather than
    // blocking the whole page.
    if (res.status === 404) return { rows: [], lastModified: null }
    throw new Error(`Could not load ${url} (${res.status})`)
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
 * Loads and merges PositionLog rows from every platform's mirrored CSV (see
 * SOURCES above). `updatedAt` reflects whichever source was written most
 * recently, so the header always shows the freshest data's age.
 */
export function usePositionLog() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState("loading") // loading | ready | error
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    let cancelled = false

    Promise.all(SOURCES.map(loadSource))
      .then((results) => {
        if (cancelled) return
        const allRows = results.flatMap((r) => r.rows)
        const times = results.map((r) => r.lastModified).filter(Boolean)
        const latest = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : new Date()
        setRows(allRows)
        setUpdatedAt(latest)
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
