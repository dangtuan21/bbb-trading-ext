import { useState } from "react"

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

export default function SettingsPage({
  warningDailyDrawdownPct,
  onWarningDailyDrawdownChange,
  warningDrawdownPct,
  onWarningDrawdownChange,
  warningTargetProfitPct,
  onWarningTargetProfitChange,
}) {
  return (
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
      </div>
    </div>
  )
}
