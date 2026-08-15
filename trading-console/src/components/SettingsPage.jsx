import { useState } from "react"

export default function SettingsPage({ alarmThresholdPct, onChange }) {
  const [text, setText] = useState(String(alarmThresholdPct))

  function commit(value) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0 && n <= 100) {
      onChange(n)
      setText(String(n))
    } else {
      setText(String(alarmThresholdPct))
    }
  }

  return (
    <div className="max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid grid-cols-[200px_1fr] items-center gap-x-4 gap-y-1">
        <label htmlFor="alarm-daily-drawdown-pct" className="text-sm font-medium text-slate-600">
          Alarm Daily Drawdown %
        </label>
        <div className="flex items-center gap-2">
          <input
            id="alarm-daily-drawdown-pct"
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
    </div>
  )
}
