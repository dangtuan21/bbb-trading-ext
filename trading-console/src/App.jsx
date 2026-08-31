import { useMemo, useState } from "react"
import Sidebar from "./components/Sidebar"
import DataTable from "./components/DataTable"
import RuleEditForm from "./components/RuleEditForm"
import SettingsPage from "./components/SettingsPage"
import { usePositionLog } from "./lib/usePositionLog"
import { useRelativeTime } from "./lib/relativeTime"
import { computeAccountLog, computeMainView } from "./lib/compute"
import { matchRules } from "./lib/matchRules"
import { hiddenAccounts } from "./lib/hiddenAccounts"
import { POSITIONLOG_FIELDS } from "./lib/schema"
import {
  useWarningDailyDrawdownThreshold,
  useWarningDrawdownThreshold,
  useWarningTargetProfitThreshold,
  useWarningTPSLEnabled,
} from "./lib/settings"

const ACCOUNTLOG_COLUMNS = [
  "Platform",
  "AccountID",
  "AccountLabel",
  "Balance",
  "Equity",
  "AccountPL",
  "Symbol",
  "Direction",
  "TotalSize",
  "SymbolPL",
]

// MainView: each row pairs an A-side account (RebelsFunding/FTMO/
// AlphaCapital -- see A_SIDE_PLATFORMS in compute.js) with the matching
// B-side position from data-fact/config.json (B columns). A row with no
// rule, or whose rule's target isn't present in the current data, still
// shows -- the B_ columns are just left blank.
//
// "A Account ID" is the only clickable cell (link: true, see DataTable) --
// clicking it opens the edit-position modal (RuleEditForm) for that row.
//
// A_Phase ("A Phase") -- RebelsFunding's own challenge phase ("1"/"2"/etc),
// read off RF Client Zone's accounts list (see Phase in
// ext-rebelsfunding/background.js). Blank for FTMO/AlphaCapital rows, which
// have nothing equivalent scraped. Placed right after A Account ID, plain
// (no highlightIf/background of its own).
//
// A_TPSL ("TP/SL") -- "TP/SL" if the account has an open position with
// both a Take Profit and a Stop Loss set, "TP"/"SL" if only one, "" if
// neither (see tpSlLabel in compute.js). An account with multiple open
// positions is flagged true for either if ANY of them has one set, same
// aggregate-across-positions approach as the A Symbol/A Direction columns.
//
// A_TargetEquity ("A Target Equity") = InitialBalance + A_ProfitTarget
// ("A Target PL") -- the account's equity once it hits its profit target,
// computed in computeMainView. Placed next to A_Equity (its "current"
// counterpart) the same way A_ProfitTarget sits next to A_AccountPL, with
// its own violet background; no highlightIf on either.
// A_PLPct ("A PL %") = (A_Equity - A_InitialBalance) / A_ProfitTarget
// ("A Target PL") as a percentage -- how much of the profit target has been
// realized so far. Shown right after A_Equity, but plain (no background
// styling of its own) -- just its warning flag (A_PLPctWarning, fired once
// A_PLPct itself reaches Warning Target Profit %), same amber highlight as
// every other warning column when triggered.
//
// A_TPSL's highlightIf (A_TPSLWarning, computed in compute.js) flags two
// cases: neither a Take Profit nor a Stop Loss is set at all, OR a Stop
// Loss specifically is missing while Daily DD is already flagged (a Take
// Profit alone doesn't cover that risk) -- gated by the "Warning TP/SL"
// Settings toggle (useWarningTPSLEnabled), so it's swapped out for
// `undefined` in App() below when the toggle is off.
//
// A_StopLossRiskAmount/A_StopLossRiskPct ("SL Risk $"/"SL Risk %") --
// computed in compute.js (the account's total dollar exposure if every open
// position's Stop Loss were hit, and that same figure as a % of Balance),
// but not shown as MainView columns right now -- hidden here rather than
// removed from compute.js, so they're easy to bring back later.
//
// A_MaxDailyDrawdownPct/A_TodayDrawdownPct ("Max Daily DD %"/"Cur Daily
// DD %") -- RebelsFunding's OWN percentages for the pair right before them
// (Max Daily DD/Cur Daily DD), scraped verbatim rather than derived. NOT
// the same ratio that drives A_DailyDrawdownWarning's highlightIf (Cur
// Daily DD / Max Daily DD vs. the configured threshold) -- the platform's
// own % uses Today's Starting Equity as the denominator instead, so it can
// read differently from the $ pair's warning state. No highlightIf of
// their own; given a distinct rose background (rather than reusing the $
// pair's amber) precisely because they can disagree with it -- sharing a
// color would visually imply they're always in sync.
const MAINVIEW_COLUMNS = [
  // Displayed abbreviated ("RF" instead of "RebelsFunding") -- via
  // DataTable's `format`, so this only changes what's rendered. The
  // underlying row.A_Platform value stays "RebelsFunding" as scraped,
  // since that's what A_SIDE_PLATFORMS/matchRules/hiddenAccounts (all in
  // compute.js/matchRules.js/hiddenAccounts.js) match against -- renaming
  // the actual data would break every one of those. FTMO/AlphaCapital are
  // already short enough and stay as-is.
  { key: "A_Platform", label: "A Platform", format: (v) => (v === "RebelsFunding" ? "RF" : v) },
  { key: "A_AccountID", label: "A Account ID", link: true },
  // RebelsFunding-only ("1"/"2"/etc, from RF Client Zone's own accounts
  // list -- see Phase in ext-rebelsfunding/background.js); blank for
  // FTMO/AlphaCapital rows.
  { key: "A_Phase", label: "A Phase" },
  { key: "A_Symbol", label: "A Symbol" },
  { key: "A_Direction", label: "A Dir" },
  { key: "A_TotalSize", label: "A Size", numeric: true },
  { key: "A_TPSL", label: "TP/SL", highlightIf: (row) => row.A_TPSLWarning },
  { key: "A_TargetEquity", label: "A Target\nEquity", money: true, headerBg: "bg-violet-900", columnBg: "bg-violet-200" },
  { key: "A_Equity", label: "A Equity", money: true, headerBg: "bg-violet-900", columnBg: "bg-violet-200" },
  { key: "A_PLPct", label: "A PL %", numeric: true, pct: true, highlightIf: (row) => row.A_PLPctWarning },
  // Labels contain a literal "\n" -- DataTable renders these as two header
  // lines (whitespace-pre-line) instead of one wide nowrap line, so these
  // 4 columns stay narrower.
  { key: "A_MaxDailyDrawdown", label: "Max Daily\nDD", money: true, highlightIf: (row) => row.A_DailyDrawdownWarning, headerBg: "bg-amber-900", columnBg: "bg-amber-50" },
  { key: "A_TodayDrawdown", label: "Cur Daily\nDD", money: true, highlightIf: (row) => row.A_DailyDrawdownWarning, headerBg: "bg-amber-900", columnBg: "bg-amber-50" },
  { key: "A_MaxDailyDrawdownPct", label: "Max Daily\nDD %", numeric: true, pct: true, headerBg: "bg-rose-900", columnBg: "bg-rose-100" },
  { key: "A_TodayDrawdownPct", label: "Cur Daily\nDD %", numeric: true, pct: true, headerBg: "bg-rose-900", columnBg: "bg-rose-100" },
  { key: "A_MaxDrawdownAmount", label: "Max DD", money: true, highlightIf: (row) => row.A_MaxDrawdownWarning, headerBg: "bg-sky-900", columnBg: "bg-sky-100" },
  { key: "A_CurrentValueAmount", label: "Cur DD", money: true, highlightIf: (row) => row.A_MaxDrawdownWarning, headerBg: "bg-sky-900", columnBg: "bg-sky-100" },
  { key: "A_ProfitTarget", label: "A Target PL", money: true, highlightIf: (row) => row.A_TargetProfitWarning, headerBg: "bg-emerald-900", columnBg: "bg-emerald-50" },
  { key: "A_AccountPL", label: "A PL", money: true, highlightIf: (row) => row.A_TargetProfitWarning, headerBg: "bg-emerald-900", columnBg: "bg-emerald-50" },
  { key: "B_SymbolPL", label: "B PL", money: true },
  { key: "B_TotalSize", label: "B Size", numeric: true },
  { key: "B_Platform", label: "B Platform" },
  { key: "Note", label: "Note" },
]

export default function App() {
  const [active, setActive] = useState("mainview")
  const { rows, status, error, updatedAt } = usePositionLog()
  const relativeUpdatedAt = useRelativeTime(updatedAt)
  const [warningDailyDrawdownPct, setWarningDailyDrawdownPct] = useWarningDailyDrawdownThreshold()
  const [warningDrawdownPct, setWarningDrawdownPct] = useWarningDrawdownThreshold()
  const [warningTargetProfitPct, setWarningTargetProfitPct] = useWarningTargetProfitThreshold()
  const [warningTPSLEnabled, setWarningTPSLEnabled] = useWarningTPSLEnabled()

  const accountLogRows = useMemo(() => computeAccountLog(rows), [rows])
  const mainView = useMemo(
    () =>
      computeMainView(
        rows,
        matchRules,
        warningDailyDrawdownPct,
        warningDrawdownPct,
        warningTargetProfitPct,
        hiddenAccounts
      ),
    [rows, warningDailyDrawdownPct, warningDrawdownPct, warningTargetProfitPct]
  )

  // Swap A_TPSL's highlightIf out for undefined when the "Warning TP/SL"
  // Settings toggle is off, rather than baking the toggle into the
  // predicate itself -- keeps MAINVIEW_COLUMNS' own highlightIf a pure
  // function of the row, same pattern as every other column.
  const mainViewColumns = useMemo(
    () =>
      warningTPSLEnabled
        ? MAINVIEW_COLUMNS
        : MAINVIEW_COLUMNS.map((col) => (col.key === "A_TPSL" ? { ...col, highlightIf: undefined } : col)),
    [warningTPSLEnabled]
  )

  // Options for RuleEditForm's B-position dropdown -- every currently-known
  // non-A-side Platform+AccountID+Symbol, deduped (an account can carry
  // multiple open positions, i.e. multiple AccountLog rows sharing an
  // AccountID with different Symbols).
  const bOptions = useMemo(() => {
    const seen = new Set()
    const options = []
    for (const r of mainView.right) {
      const key = `${r.Platform}|${r.AccountID}|${r.Symbol}`
      if (seen.has(key) || r.Symbol === "n/a") continue
      seen.add(key)
      options.push({ platform: r.Platform, accountId: r.AccountID, symbol: r.Symbol })
    }
    return options
  }, [mainView.right])

  // MainView's own "Active"/"Inactive"/"All" filter -- both Active and
  // Inactive key off the exact same test compute.js's hasOpenPosition and
  // the rowBg gray-dimming below already use (A_Symbol === "n/a"), so
  // "empty A Symbol" means one single thing everywhere in this file rather
  // than several slightly different ones. Defaults to "active" since a no-
  // position account is exactly the kind of row rowBg already dims to gray
  // as "nothing to see here" -- Active just removes it instead of dimming
  // it; Inactive is the complement, for the opposite question ("which
  // accounts have nothing open right now"). Plain useState, not a
  // persisted setting like the warning thresholds -- a view filter, not
  // account configuration.
  const [mainViewFilter, setMainViewFilter] = useState("active")
  const mainViewRows = useMemo(() => {
    if (mainViewFilter === "active") return mainView.joined.filter((row) => row.A_Symbol !== "n/a")
    if (mainViewFilter === "inactive") return mainView.joined.filter((row) => row.A_Symbol === "n/a")
    return mainView.joined
  }, [mainView.joined, mainViewFilter])

  const [editingRow, setEditingRow] = useState(null)

  // The top-right row count: on MainView specifically, this should track
  // the CURRENT filter (Active/Inactive/All), i.e. mainViewRows.length --
  // not rows.length, which is the raw PositionLog row count (one row per
  // open position, not per account, and never filtered at all) and would
  // silently stay fixed while the Active/Inactive/All radios above visibly
  // change what's on screen. Every other tab keeps showing rows.length,
  // unchanged.
  const headerRowCount = active === "mainview" ? mainViewRows.length : rows.length

  return (
    <div className="flex h-screen w-screen bg-slate-100">
      <Sidebar active={active} onSelect={setActive} />

      <main className="flex-1 overflow-auto p-6">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-slate-800">{titleFor(active)}</h2>
          {status === "ready" && active !== "settings" && (
            <span className="text-xs text-slate-400">
              {headerRowCount} row{headerRowCount === 1 ? "" : "s"} · {relativeUpdatedAt ?? "data/positions.csv"}
            </span>
          )}
        </header>

        {active === "settings" && (
          <SettingsPage
            warningDailyDrawdownPct={warningDailyDrawdownPct}
            onWarningDailyDrawdownChange={setWarningDailyDrawdownPct}
            warningDrawdownPct={warningDrawdownPct}
            onWarningDrawdownChange={setWarningDrawdownPct}
            warningTargetProfitPct={warningTargetProfitPct}
            onWarningTargetProfitChange={setWarningTargetProfitPct}
            warningTPSLEnabled={warningTPSLEnabled}
            onWarningTPSLChange={setWarningTPSLEnabled}
            hiddenAccounts={hiddenAccounts}
          />
        )}

        {active !== "settings" && status === "loading" && (
          <p className="text-sm text-slate-400">Loading positions.csv...</p>
        )}

        {active !== "settings" && status === "error" && (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn't load the CSV data: {error}
          </p>
        )}

        {status === "ready" && active === "mainview" && (
          <>
            <div className="mb-3 flex items-center gap-4 text-sm text-slate-600">
              <span className="font-medium">Filter:</span>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="mainview-filter"
                  checked={mainViewFilter === "active"}
                  onChange={() => setMainViewFilter("active")}
                />
                Active
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="mainview-filter"
                  checked={mainViewFilter === "inactive"}
                  onChange={() => setMainViewFilter("inactive")}
                />
                Inactive
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="mainview-filter"
                  checked={mainViewFilter === "all"}
                  onChange={() => setMainViewFilter("all")}
                />
                All
              </label>
            </div>
            {/* rowBg dims a no-open-position account (A_Symbol is "n/a") to a
                flat light gray across the whole row -- same rows whose
                warnings are already suppressed in compute.js
                (hasOpenPosition), and the same rows the "Active" filter
                above removes entirely (or the ONLY rows "Inactive" keeps).
                Left in place (rather than dropped now that Active/Inactive
                can already narrow to one or the other) since "All" still
                shows a mix of both, and no-position rows should still read
                as "nothing to see here" there. */}
            <DataTable
              columns={mainViewColumns}
              rows={mainViewRows}
              emptyMessage={
                mainViewFilter === "active"
                  ? "No accounts with an open position right now -- switch to \"All\" to see every account."
                  : mainViewFilter === "inactive"
                    ? "No accounts without an open position right now -- switch to \"All\" to see every account."
                    : "No RebelsFunding, FTMO, or AlphaCapital accounts in this snapshot yet."
              }
              onRowClick={setEditingRow}
              rowBg={(row) => (row.A_Symbol === "n/a" ? "bg-gray-400" : "")}
            />
          </>
        )}

        {status === "ready" && active === "positionlog" && (
          <DataTable columns={POSITIONLOG_FIELDS} rows={rows} />
        )}

        {status === "ready" && active === "accountlog" && (
          <DataTable columns={ACCOUNTLOG_COLUMNS} rows={accountLogRows} />
        )}
      </main>

      {editingRow && (
        <RuleEditForm
          row={editingRow}
          bOptions={bOptions}
          onClose={() => setEditingRow(null)}
          onSaved={() => setEditingRow(null)}
        />
      )}
    </div>
  )
}

function titleFor(id) {
  switch (id) {
    case "accountlog":
      return "Account Log"
    case "mainview":
      return "Main View"
    case "settings":
      return "Settings"
    default:
      return "Position Log"
  }
}
