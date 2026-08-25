import { useState } from "react"

const SERVER_URL = "http://127.0.0.1:8765"

function ThresholdField({ id, label, value, onChange }) {
  const [text, setText] = useState(String(value))

  function commit(raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n <= 100) {
      onChange(n)
      setText(String(n))
    } else {
      setText(String(value))
    }
  }

  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-x-4 gap-y-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-600">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min="1"
          max="100"
          step="1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
        />
        <span className="text-sm text-slate-500">%</span>
      </div>
    </div>
  )
}

function ToggleField({ id, label, value, onChange }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-x-4 gap-y-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-600">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`w-16 rounded-full py-1.5 text-center text-xs font-semibold transition-colors ${
          value ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-600"
        }`}
      >
        {value ? "On" : "Off"}
      </button>
    </div>
  )
}

// Lists every account hidden via RuleEditForm's "Hide Account" button (see
// lib/hiddenAccounts.js) with an "Unhide" button per row -- the only place
// to reverse a hide, since a hidden row has no MainView link to reopen the
// edit modal from. No local list-shrinking on success: editing config.json
// makes Vite's dev-server file watcher reload the page, same mechanism
// RuleEditForm's Save/Delete already rely on to pick up config.json
// changes, so `hiddenAccounts` itself refreshes without any extra
// plumbing here.
function HiddenAccountsSection({ hiddenAccounts }) {
  const [busyKey, setBusyKey] = useState(null)
  const [error, setError] = useState(null)

  async function handleUnhide(platform, accountId) {
    const key = `${platform}|${accountId}`
    setBusyKey(key)
    setError(null)
    try {
      const res = await fetch(`${SERVER_URL}/config/account-visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aPlatform: platform, aAccountId: accountId, hidden: false }),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || "Server rejected the update")
    } catch (err) {
      setError(`Could not unhide (${err.message}). Is ext-server running?`)
      setBusyKey(null)
    }
  }

  if (!hiddenAccounts.length) return null

  return (
    <div className="max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Hidden Accounts</h3>
      <p className="mb-3 text-xs text-slate-400">
        Excluded from MainView -- still scraped and recorded, just not shown.
      </p>
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      <ul className="flex flex-col gap-1.5">
        {hiddenAccounts.map((h) => {
          const key = `${h.platform}|${h.accountId}`
          return (
            <li
              key={key}
              className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm"
            >
              <span className="text-slate-700">
                {h.platform} · {h.accountId}
              </span>
              <button
                type="button"
                onClick={() => handleUnhide(h.platform, h.accountId)}
                disabled={busyKey === key}
                className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
              >
                {busyKey === key ? "Unhiding..." : "Unhide"}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function SettingsPage({
  warningDailyDrawdownPct,
  onWarningDailyDrawdownChange,
  warningDrawdownPct,
  onWarningDrawdownChange,
  warningTargetProfitPct,
  onWarningTargetProfitChange,
  warningTPSLEnabled,
  onWarningTPSLChange,
  hiddenAccounts,
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4">
          <ThresholdField
            id="warning-daily-drawdown-pct"
            label="Warning Daily Drawdown %"
            value={warningDailyDrawdownPct}
            onChange={onWarningDailyDrawdownChange}
          />
          <ThresholdField
            id="warning-drawdown-pct"
            label="Warning Drawdown %"
            value={warningDrawdownPct}
            onChange={onWarningDrawdownChange}
          />
          <ThresholdField
            id="warning-target-profit-pct"
            label="Warning Target Profit %"
            value={warningTargetProfitPct}
            onChange={onWarningTargetProfitChange}
          />
          <ToggleField
            id="warning-tpsl-enabled"
            label="Warning TP/SL"
            value={warningTPSLEnabled}
            onChange={onWarningTPSLChange}
          />
        </div>
      </div>
      <HiddenAccountsSection hiddenAccounts={hiddenAccounts ?? []} />
    </div>
  )
}
