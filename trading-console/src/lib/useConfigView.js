import { useEffect, useState } from "react"
import { parseMatchRules, matchRules as staticMatchRules } from "./matchRules"
import { parseHiddenAccounts, hiddenAccounts as staticHiddenAccounts } from "./hiddenAccounts"

const CONFIG_URL = `${import.meta.env.BASE_URL}data/config.json`

async function loadConfig() {
  const res = await fetch(CONFIG_URL, { cache: "no-store" })
  if (!res.ok) {
    // Missing mirror file (e.g. server not yet redeployed with the mirror
    // write, or no rule ever saved) is a normal state -- fall back to the
    // build-time snapshot rather than blocking the page.
    if (res.status === 404) {
      return { matchRules: staticMatchRules, hiddenAccounts: staticHiddenAccounts }
    }
    throw new Error(`Could not load ${CONFIG_URL} (${res.status})`)
  }
  const json = await res.json()
  return { matchRules: parseMatchRules(json), hiddenAccounts: parseHiddenAccounts(json) }
}

// Fired (via notifyConfigChanged, below) whenever something writes to
// config.json through the API -- RuleEditForm's Save/Delete/Hide, so far.
// useConfigView listens for it below and re-fetches. Without this, saving a
// rule closed the modal but the grid underneath (AccountViewPage/
// MarketViewPage/AccountChartsPage, all still mounted the whole time the
// modal was open) kept showing whatever matchRules/hiddenAccounts it
// fetched on its own original mount -- the edit was live in config.json and
// would show up on the next manual page reload, just not right away. A
// plain window event (rather than e.g. lifting state to App.jsx) is what
// lets every currently-mounted useConfigView() instance pick it up without
// RuleEditForm needing to know who's listening.
const CONFIG_CHANGED_EVENT = "bbb:config-changed"

export function notifyConfigChanged() {
  window.dispatchEvent(new Event(CONFIG_CHANGED_EVENT))
}

/**
 * useConfigView(): loads match-rules/hidden-accounts from config.json's
 * runtime mirror (data/config.json, written by ext-server alongside the
 * canonical src/data-fact/config.json -- see server.js's CONFIG_MIRROR_FILE),
 * fetched on mount and again every time notifyConfigChanged() fires.
 *
 * matchRules.js/hiddenAccounts.js ALSO export `matchRules`/`hiddenAccounts`
 * as a static, build-time-only snapshot: Vite inlines config.json's content
 * into the JS bundle at build time via a static import, so that snapshot
 * never changes again after a save -- RuleEditForm/SettingsPage write
 * straight to config.json on the server, but without this hook nothing on
 * an already-built, already-deployed page would ever see the update short
 * of a full rebuild+redeploy. This hook is what makes rule edits actually
 * show up in the UI. It uses that static snapshot as the initial value (for
 * a fast first paint) and again if the fetch ever fails, so a slow or
 * broken fetch degrades to "stale" rather than "empty".
 */
export function useConfigView() {
  const [matchRules, setMatchRules] = useState(staticMatchRules)
  const [hiddenAccounts, setHiddenAccounts] = useState(staticHiddenAccounts)
  const [status, setStatus] = useState("loading") // loading | ready | error
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    function refresh() {
      loadConfig()
        .then(({ matchRules, hiddenAccounts }) => {
          if (cancelled) return
          setMatchRules(matchRules)
          setHiddenAccounts(hiddenAccounts)
          setStatus("ready")
        })
        .catch((err) => {
          if (cancelled) return
          setError(err.message)
          setStatus("error")
        })
    }

    refresh()
    window.addEventListener(CONFIG_CHANGED_EVENT, refresh)

    return () => {
      cancelled = true
      window.removeEventListener(CONFIG_CHANGED_EVENT, refresh)
    }
  }, [])

  return { matchRules, hiddenAccounts, status, error }
}
