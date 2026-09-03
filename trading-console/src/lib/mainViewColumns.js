import { useMemo } from "react"
import { useWarningTPSLEnabled } from "./settings"

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
// A_PLPct ("A PL %") -- computed in computeMainView: (A_Equity -
// A_InitialBalance) / A_ProfitTarget while Equity is at or above
// InitialBalance (how much of the profit target has been realized), or
// -A_CurrentValueAmount / A_MaxDrawdownAmount -- "Cur DD"/"Max DD" -- once
// Equity has dropped below InitialBalance (how much of the max drawdown
// allowance has been used up, negated so it reads as a loss) -- see the
// comment on plPct in compute.js for why.
// Shown right after A_Equity, but plain (no background styling of its own)
// -- just its warning flag (A_PLPctWarning, fired once A_PLPct itself
// reaches Warning Target Profit %), same amber highlight as every other
// warning column when triggered.
//
// A_TPSL's highlightIf (A_TPSLWarning, computed in compute.js) flags two
// cases: neither a Take Profit nor a Stop Loss is set at all, OR a Stop
// Loss specifically is missing while Daily DD is already flagged (a Take
// Profit alone doesn't cover that risk) -- gated by the "Warning TP/SL"
// Settings toggle (useWarningTPSLEnabled), so App.jsx swaps A_TPSL's
// highlightIf out for `undefined` (see mainViewColumns in App.jsx) when the
// toggle is off, rather than baking the toggle into this file.
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
//
// Shared by both AccountViewPage and MarketViewPage, via useMainViewColumns
// below -- Market View needs no column config of its own: market-
// positions.csv is written in EXACTLY positions.csv's own format (see
// market-server/server.js's computeMarketPositions -- every RebelsFunding/
// FTMO/tastyfx open position's Latest/PositionPL/Equity refreshed from
// market-server's last FX poll, everything else -- AlphaCapital, no-open-
// position accounts -- copied through unchanged), so it runs through the
// exact same computeMainView() and MAINVIEW_COLUMNS real MainView uses.
export const MAINVIEW_COLUMNS = [
  // Displayed abbreviated ("RF" instead of "RebelsFunding") -- via
  // DataTable's `format`, so this only changes what's rendered. The
  // underlying row.A_Platform value stays "RebelsFunding" as scraped,
  // since that's what A_SIDE_PLATFORMS/matchRules/hiddenAccounts (all in
  // compute.js/matchRules.js/hiddenAccounts.js) match against -- renaming
  // the actual data would break every one of those. FTMO/AlphaCapital are
  // already short enough and stay as-is.
  { key: "A_Platform", label: "A Plat", format: (v) => (v === "RebelsFunding" ? "RF" : v) },
  { key: "A_AccountID", label: "A Account ID", link: true },
  // RebelsFunding-only ("1"/"2"/etc, from RF Client Zone's own accounts
  // list -- see Phase in ext-rebelsfunding/background.js); blank for
  // FTMO/AlphaCapital rows.
  { key: "A_Phase", label: "A Phase" },
  { key: "A_Symbol", label: "A Symbol" },
  { key: "A_Direction", label: "A Dir" },
  { key: "A_TotalSize", label: "A Size", numeric: true },
  { key: "A_TPSL", label: "TP/SL", highlightIf: (row) => row.A_TPSLWarning },
  // RF-Trader's own live Balance (scraped off its summary bar -- see
  // fnScrapeBalanceEquity in ext-rebelsfunding/background.js -- Balance/
  // UPL/Equity/Used Margin/Free Margin/Margin Level), NOT Initial Balance
  // (the challenge's starting size, already shown separately via
  // A_TargetEquity/InitialBalance math). Already computed in compute.js
  // (A_Balance: l.Balance) -- this just surfaces it as its own column,
  // plain (no highlightIf/background) since it isn't itself a warning
  // signal the way A_TargetEquity/A_Equity are.
  { key: "A_Balance", label: "A Bal", money: true },
  { key: "A_TargetEquity", label: "A Target Equity", money: true, headerBg: "bg-violet-900", columnBg: "bg-violet-200" },
  { key: "A_Equity", label: "A Equity", money: true, headerBg: "bg-violet-900", columnBg: "bg-violet-200" },
  { key: "A_PLPct", label: "A PL %", numeric: true, pct: true, highlightIf: (row) => row.A_PLPctWarning },
  // Labels contain a literal "\n", broken after the first word (e.g. "Max\n
  // Daily DD") -- DataTable renders these as two header lines
  // (whitespace-pre-line); `width` widens just enough that the longer
  // second line ("Daily DD %") still fits on one line instead of wrapping
  // to a 3rd/4th.
  { key: "A_MaxDailyDrawdown", label: "Max\nDaily DD", money: true, width: "min-w-[6.5rem]", highlightIf: (row) => row.A_DailyDrawdownWarning, headerBg: "bg-amber-900", columnBg: "bg-amber-50" },
  { key: "A_TodayDrawdown", label: "Cur\nDaily DD", money: true, width: "min-w-[6.5rem]", highlightIf: (row) => row.A_DailyDrawdownWarning, headerBg: "bg-amber-900", columnBg: "bg-amber-50" },
  { key: "A_MaxDailyDrawdownPct", label: "Max\nDaily DD %", numeric: true, pct: true, width: "min-w-[7rem]", headerBg: "bg-rose-900", columnBg: "bg-rose-100" },
  { key: "A_TodayDrawdownPct", label: "Cur\nDaily DD %", numeric: true, pct: true, width: "min-w-[7rem]", headerBg: "bg-rose-900", columnBg: "bg-rose-100" },
  { key: "A_MaxDrawdownAmount", label: "Max DD", money: true, highlightIf: (row) => row.A_MaxDrawdownWarning, headerBg: "bg-sky-900", columnBg: "bg-sky-100" },
  { key: "A_CurrentValueAmount", label: "Cur DD", money: true, highlightIf: (row) => row.A_MaxDrawdownWarning, headerBg: "bg-sky-900", columnBg: "bg-sky-100" },
  { key: "A_ProfitTarget", label: "A Target PL", money: true, highlightIf: (row) => row.A_TargetProfitWarning, headerBg: "bg-emerald-900", columnBg: "bg-emerald-50" },
  { key: "A_AccountPL", label: "A PL", money: true, highlightIf: (row) => row.A_TargetProfitWarning, headerBg: "bg-emerald-900", columnBg: "bg-emerald-50" },
  { key: "B_SymbolPL", label: "B PL", money: true },
  { key: "B_TotalSize", label: "B Size", numeric: true },
  { key: "B_Platform", label: "B Plat" },
  { key: "Note", label: "Note" },
]

/**
 * AccountViewPage/MarketViewPage's own columns -- MAINVIEW_COLUMNS above,
 * with A_TPSL's highlightIf swapped out for `undefined` when the "Warning
 * TP/SL" Settings toggle is off, rather than baking the toggle into the
 * predicate itself (keeps MAINVIEW_COLUMNS' own highlightIf a pure function
 * of the row, same pattern as every other column). Called independently by
 * each of AccountViewPage/MarketViewPage rather than computed once in
 * App.jsx and passed down -- both read the same useWarningTPSLEnabled()
 * localStorage-backed setting, and since only one tab is ever mounted at a
 * time (see App.jsx's `active` state), there's no risk of the two getting
 * out of sync with each other or with the Settings page.
 */
export function useMainViewColumns() {
  const [warningTPSLEnabled] = useWarningTPSLEnabled()
  return useMemo(
    () =>
      warningTPSLEnabled
        ? MAINVIEW_COLUMNS
        : MAINVIEW_COLUMNS.map((col) => (col.key === "A_TPSL" ? { ...col, highlightIf: undefined } : col)),
    [warningTPSLEnabled]
  )
}
