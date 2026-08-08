import { useState } from "react"

const SERVER_URL = "http://127.0.0.1:8765"

/**
 * MainView's rule editor. Opened by clicking an A-side row; edits the rule
 * currently in effect for that row (row._rule, set by computeMainView --
 * null means no rule matched at all, in which case this only ever appends).
 *
 * "Save" replaces the matched rule in place (via originalASymbol, so the
 * server can find it even if the Symbol field itself changed). "Save as New
 * Rule" always appends instead, regardless of what was matched -- how you
 * add a symbol-specific override alongside an existing blanket rule for the
 * same account (or vice versa) without touching the original.
 */
export default function RuleEditForm({ row, bOptions, onClose, onSaved }) {
  const hasExistingRule = row._rule !== null
  const originalASymbol = hasExistingRule ? row._rule.aSymbol : null

  const [symbol, setSymbol] = useState(hasExistingRule ? row._rule.aSymbol ?? "" : "")
  const [bKey, setBKey] = useState(
    hasExistingRule && row._rule.bPlatform
      ? `${row._rule.bPlatform}|${row._rule.bAccountId}|${row._rule.bSymbol}`
      : ""
  )
  const [sl, setSl] = useState(row.SL ?? "")
  const [tp, setTp] = useState(row.TP ?? "")
  const [dd, setDd] = useState(row.A_DD ?? "")
  const [note, setNote] = useState(row.Note ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function buildPayload(asNew) {
    const bParts = bKey ? bKey.split("|") : null
    return {
      aPlatform: row.A_Platform,
      aAccountId: row.A_AccountID,
      aSymbol: symbol.trim() || null,
      ...(asNew ? {} : { originalASymbol }),
      bPlatform: bParts ? bParts[0] : null,
      bAccountId: bParts ? bParts[1] : null,
      bSymbol: bParts ? bParts[2] : null,
      stopLoss: sl === "" ? null : Number(sl),
      takeProfit: tp === "" ? null : Number(tp),
      dailyDrawdown: dd === "" ? null : Number(dd),
      note: note.trim() || null,
    }
  }

  async function handleSave(asNew) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER_URL}/config/rule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(asNew)),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || "Server rejected the update")
      onSaved()
    } catch (err) {
      setError(`Could not save (${err.message}). Is ext-server running?`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-800">
          {row.A_Platform} · {row.A_AccountID}
        </h3>
        <p className="mb-4 text-xs text-slate-400">
          {hasExistingRule ? "Editing existing rule" : "No rule configured yet -- this will create one"}
        </p>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Symbol (optional)</span>
          <input
            type="text"
            list="rule-open-symbols"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Any symbol (blanket rule)"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <datalist id="rule-open-symbols">
            {row._openSymbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Match B-position</span>
          <select
            value={bKey}
            onChange={(e) => setBKey(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">(none)</option>
            {bOptions.map((o) => {
              const key = `${o.platform}|${o.accountId}|${o.symbol}`
              return (
                <option key={key} value={key}>
                  {o.platform} · {o.accountId} · {o.symbol}
                </option>
              )
            })}
          </select>
        </label>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Stop Loss</span>
            <input
              type="number"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Take Profit</span>
            <input
              type="number"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">A-DailyDrawdown</span>
          <input
            type="number"
            value={dd}
            onChange={(e) => setDd(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          {hasExistingRule && (
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving}
              className="rounded-md border border-indigo-600 px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50"
            >
              Save as New Rule
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
