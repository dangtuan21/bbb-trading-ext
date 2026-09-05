import { useEffect, useState } from "react"
import { hiddenAccounts } from "../lib/hiddenAccounts"
import {
  useWarningDailyDrawdownThreshold,
  useWarningDrawdownThreshold,
  useWarningTargetProfitThreshold,
  useWarningTPSLEnabled,
  useDailyDdChartScaleMax,
} from "../lib/settings"

const SERVER_URL = import.meta.env.DEV ? "http://127.0.0.1:8765" : "/api/ext"

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

// Generic labeled radio-group field -- `options` is [{ value, label }, ...].
// Used for Alert Data Source below (its only current user); kept generic
// rather than hardcoding market/account in case another radio-style setting
// shows up later.
function RadioField({ id, label, value, options, onChange, disabled }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-x-4 gap-y-1">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <div className="flex items-center gap-4">
        {options.map((opt) => (
          <label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
            <input
              type="radio"
              name={id}
              checked={value === opt.value}
              disabled={disabled}
              onChange={() => onChange(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  )
}

// Which data feeds the Pushover phone alerts ext-server's
// checkWarningsAndNotify() sends (see that file's own comment) --
// "market" (default) reads market-server's FX-priced market-positions.csv
// (same numbers as Market View/Market Chart), "account" reads this app's
// own scraped positions.csv (same numbers as Account View/Account Chart).
// Deliberately NOT a localStorage setting like the warning thresholds
// above: this has to be readable by ext-server itself (a separate Node
// process with no access to the browser's localStorage) to actually
// change what it alerts on, so it's persisted server-side in
// notify-config.json via GET/POST /config/notify-settings and
// /config/notify-data-source instead -- fetched on mount, posted on
// change, same pattern HiddenAccountsSection below uses for its own
// server round trips.
function NotifyDataSourceSection() {
  const [dataSource, setDataSource] = useState(null) // null while loading
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${SERVER_URL}/config/notify-settings`)
      .then((res) => res.json())
      .then((result) => {
        if (cancelled) return
        if (!result.ok) throw new Error(result.error || "Server rejected the request")
        setDataSource(result.dataSource)
      })
      .catch((err) => {
        if (cancelled) return
        setError(`Could not load current setting (${err.message}). Is ext-server running?`)
        setDataSource("market") // still show something selectable rather than a blank radio group
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleChange(next) {
    const previous = dataSource
    setDataSource(next) // optimistic -- matches ThresholdField/ToggleField's own immediate-feedback feel
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER_URL}/config/notify-data-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSource: next }),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || "Server rejected the update")
    } catch (err) {
      setError(`Could not save (${err.message}). Is ext-server running?`)
      setDataSource(previous)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <RadioField
          id="notify-data-source"
          label="Alert Data Source"
          value={dataSource}
          disabled={dataSource === null || saving}
          onChange={handleChange}
          options={[
            { value: "market", label: "Market" },
            { value: "account", label: "Account" },
          ]}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
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
        Excluded from Account View -- still scraped and recorded, just not shown.
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

// Settings has no CSV fetch of its own (nothing to be "loading" or
// "error" here, unlike every other tab -- see those pages' own PageHeader
// usage), so it renders a plain title rather than pulling in PageHeader's
// status-driven loading/error/row-count machinery for a page that never
// uses any of it.
//
// Reads/writes all four warning settings and hiddenAccounts itself, via the
// same hooks/import AccountViewPage/AccountChartsPage/MarketViewPage read
// from (useMainViewFor/useMainViewColumns) -- takes no props at all, rather
// than App.jsx owning this state and threading value/onChange pairs down.
// Since Settings is never mounted at the same time as any tab that reads
// these (only one tab renders at a time), a change made here is simply
// picked up fresh the next time a data page mounts and calls its own copy
// of the same hook -- no cross-instance sync needed.
export default function SettingsPage() {
  const [warningDailyDrawdownPct, setWarningDailyDrawdownPct] = useWarningDailyDrawdownThreshold()
  const [warningDrawdownPct, setWarningDrawdownPct] = useWarningDrawdownThreshold()
  const [warningTargetProfitPct, setWarningTargetProfitPct] = useWarningTargetProfitThreshold()
  const [warningTPSLEnabled, setWarningTPSLEnabled] = useWarningTPSLEnabled()
  const [dailyDdChartScaleMax, setDailyDdChartScaleMax] = useDailyDdChartScaleMax()

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-slate-800">Settings</h2>
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4">
          <ThresholdField
            id="warning-daily-drawdown-pct"
            label="Warning Daily Drawdown %"
            value={warningDailyDrawdownPct}
            onChange={setWarningDailyDrawdownPct}
          />
          <ThresholdField
            id="warning-drawdown-pct"
            label="Warning Drawdown %"
            value={warningDrawdownPct}
            onChange={setWarningDrawdownPct}
          />
          <ThresholdField
            id="warning-target-profit-pct"
            label="Warning Target Profit %"
            value={warningTargetProfitPct}
            onChange={setWarningTargetProfitPct}
          />
          <ToggleField
            id="warning-tpsl-enabled"
            label="Warning TP/SL"
            value={warningTPSLEnabled}
            onChange={setWarningTPSLEnabled}
          />
          <ThresholdField
            id="daily-dd-chart-scale-max"
            label="Daily DD Chart Fallback Scale %"
            value={dailyDdChartScaleMax}
            onChange={setDailyDdChartScaleMax}
          />
        </div>
      </div>
      <NotifyDataSourceSection />
      <HiddenAccountsSection hiddenAccounts={hiddenAccounts} />
    </div>
  )
}
