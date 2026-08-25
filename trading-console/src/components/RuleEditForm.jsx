import { useState } from "react"

const SERVER_URL = "http://127.0.0.1:8765"

/**
 * MainView's rule editor (the "edit position" modal). Opened by clicking an
 * A-side row's Account ID link; edits the rule
 * currently in effect for that row (row._rule, set by computeMainView --
 * null means no rule matched at all, in which case this only ever appends).
 *
 * "Save" replaces the matched rule in place (via originalASymbol, so the
 * server can find it even if the Symbol field itself changed). "Delete"
 * (only shown when hasExistingRule) removes that rule from config.json
 * entirely via DELETE /config/rule -- there's nothing to delete for a row
 * with no existing rule, since Save would just create a new one.
 *
 * "Hide Account" is a separate concept from the rule entirely -- it
 * excludes the row from MainView outright (see lib/hiddenAccounts.js),
 * which a rule can't do since a row shows with or without one. Always
 * available (no hasExistingRule gate), since an account can need hiding
 * whether or not it ever had a rule -- e.g. a closed account that still has
 * a balance/equity snapshot in positions.csv and would otherwise keep
 * showing forever. Unhiding happens from Settings, not here, since a hidden
 * row has no link to reopen this modal from.
 *
 * Stop Loss/Take Profit are no longer part of this form or the underlying
 * rule shape at all (dropped from MainView, compute.js, matchRules.js, and
 * server.js's applyRuleEdit) -- config.json's rules no longer carry a
 * "Stoploss-Takeprofit" field.
 */
export default function RuleEditForm({ row, bOptions, onClose, onSaved }) {
  const hasExistingRule = row._rule !== null
  const originalASymbol = hasExistingRule ? row._rule.aSymbol : null

  // Read-only, always reflects whatever's actually open right now
  // (row.A_Symbol, the same value MainView's "A Symbol" column shows) --
  // no longer editable, and no longer initialized from the existing rule's
  // own aSymbol, so the rule this form saves always tracks the live
  // position rather than something the user typed in once.
  const symbol = row.A_Symbol && row.A_Symbol !== "n/a" ? row.A_Symbol : ""
  const [bKey, setBKey] = useState(
    hasExistingRule && row._rule.bPlatform
      ? `${row._rule.bPlatform}|${row._rule.bAccountId}|${row._rule.bSymbol}`
      : ""
  )
  const [note, setNote] = useState(row.Note ?? "")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [hiding, setHiding] = useState(false)
  const [error, setError] = useState(null)
  const busy = saving || deleting || hiding

  function buildPayload() {
    const bParts = bKey ? bKey.split("|") : null
    return {
      aPlatform: row.A_Platform,
      aAccountId: row.A_AccountID,
      aSymbol: symbol.trim() || null,
      originalASymbol,
      bPlatform: bParts ? bParts[0] : null,
      bAccountId: bParts ? bParts[1] : null,
      bSymbol: bParts ? bParts[2] : null,
      note: note.trim() || null,
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER_URL}/config/rule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
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

  // Removes this row's matched rule (B-position pairing, Daily DD override,
  // and Note) entirely from config.json -- only ever shown when there's an
  // existing rule to remove (see hasExistingRule below), so there's nothing
  // to delete for a row that would otherwise just create a new rule on Save.
  async function handleDelete() {
    if (
      !window.confirm(
        `Delete the rule for ${row.A_Platform} · ${row.A_AccountID}${
          originalASymbol ? ` · ${originalASymbol}` : ""
        }? This removes its B-position match, Daily DD override, and Note.`
      )
    ) {
      return
    }
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER_URL}/config/rule`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aPlatform: row.A_Platform,
          aAccountId: row.A_AccountID,
          aSymbol: originalASymbol,
        }),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || "Server rejected the delete")
      onSaved()
    } catch (err) {
      setError(`Could not delete (${err.message}). Is ext-server running?`)
    } finally {
      setDeleting(false)
    }
  }

  // Excludes this account from MainView entirely (see lib/hiddenAccounts.js)
  // -- reversible from Settings' "Unhide" button, so no confirm() prompt
  // here (unlike handleDelete, which has no such undo path from the UI).
  async function handleHide() {
    setHiding(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER_URL}/config/account-visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aPlatform: row.A_Platform, aAccountId: row.A_AccountID, hidden: true }),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || "Server rejected the update")
      onSaved()
    } catch (err) {
      setError(`Could not hide (${err.message}). Is ext-server running?`)
    } finally {
      setHiding(false)
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
          <span className="mb-1 block font-medium text-slate-600">Symbol</span>
          <input
            type="text"
            value={symbol || "(none open)"}
            readOnly
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-500"
          />
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

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleHide}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50"
            >
              {hiding ? "Hiding..." : "Hide Account"}
            </button>
            {hasExistingRule && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
