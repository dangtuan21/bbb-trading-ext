// Client-side roll-up of the raw PositionLog rows into an AccountLog view
// (one row per Platform+AccountID+Symbol).

import {
  DEFAULT_WARNING_DAILY_DRAWDOWN_PCT,
  DEFAULT_WARNING_DRAWDOWN_PCT,
  DEFAULT_WARNING_TARGET_PROFIT_PCT,
} from "./settings"

function toNumber(value) {
  const n = parseFloat(value)
  return Number.isNaN(n) ? null : n
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * AccountLog: one row per Platform+AccountID+Symbol, aggregated from
 * PositionLog. Direction is the set of distinct directions seen for that
 * symbol (joined with ", "); TotalSize/SymbolPL are sums across every
 * PositionLog row in the group.
 */
export function computeAccountLog(rows) {
  const groups = new Map()

  for (const row of rows) {
    const key = `${row.Platform}|${row.AccountID}|${row.Symbol}`
    if (!groups.has(key)) {
      groups.set(key, {
        Platform: row.Platform,
        AccountID: row.AccountID,
        AccountLabel: row.AccountLabel,
        Balance: row.Balance,
        Equity: row.Equity,
        AccountPL: row.AccountPL,
        Symbol: row.Symbol,
        directions: new Set(),
        totalSize: 0,
        symbolPL: 0,
      })
    }
    const g = groups.get(key)
    if (row.Direction && row.Direction !== "n/a") g.directions.add(row.Direction)

    const size = toNumber(row.Size)
    if (size !== null) g.totalSize += size

    const pl = toNumber(row.PositionPL)
    if (pl !== null) g.symbolPL += pl
  }

  return [...groups.values()].map((g) => ({
    Platform: g.Platform,
    AccountID: g.AccountID,
    AccountLabel: g.AccountLabel,
    Balance: g.Balance,
    Equity: g.Equity,
    AccountPL: g.AccountPL,
    Symbol: g.Symbol,
    Direction: g.directions.size ? [...g.directions].join(", ") : "n/a",
    TotalSize: round2(g.totalSize),
    SymbolPL: round2(g.symbolPL),
  }))
}

// Platforms treated as the "A" side of MainView -- their accounts form the
// left block; a platform can't be matched against itself, so these are
// excluded from the right block. Matches config.json's "A-position" prefix
// for every rule (RebelsFunding/FTMO/AlphaCapital), never "tastyfx" (always
// the "B" match target there).
const A_SIDE_PLATFORMS = new Set(["RebelsFunding", "AlphaCapital", "FTMO"])

/**
 * MainView: left block = one row per A-side ACCOUNT (account-level, not one
 * row per position -- an account with N open positions has N PositionLog
 * rows, grouped here by AccountID). Right block = one row per non-A-side
 * Platform+AccountID+Symbol, from AccountLog.
 *
 * `matchRules` (from data-fact/config.json via lib/matchRules.js) drives the
 * row-level join: each left row is only paired with the specific right row
 * an explicit rule points it at, not just any row sharing a Symbol. A left
 * row whose account+symbol has no rule, or whose rule's target isn't
 * present in the current data, still shows -- the B_ columns are just left
 * blank rather than dropping the row.
 *
 * `hiddenAccounts` (from data-fact/config.json via lib/hiddenAccounts.js)
 * fully excludes an A-side account's row, unlike matchRules -- there's no
 * rule that can do this, since a row shows regardless of whether it has a
 * rule at all (see above). Filtered at the very start of the rows loop, so
 * a hidden account never even enters leftGroups/left/joined.
 */
export function computeMainView(
  rows,
  matchRules = [],
  warningDailyDrawdownPct = DEFAULT_WARNING_DAILY_DRAWDOWN_PCT,
  warningDrawdownPct = DEFAULT_WARNING_DRAWDOWN_PCT,
  warningTargetProfitPct = DEFAULT_WARNING_TARGET_PROFIT_PCT,
  hiddenAccounts = []
) {
  const hiddenKeys = new Set(hiddenAccounts.map((h) => `${h.platform}|${h.accountId}`))
  const leftGroups = new Map()
  for (const row of rows) {
    if (!A_SIDE_PLATFORMS.has(row.Platform)) continue
    // Keyed by Platform+AccountID, not AccountID alone, since more than one
    // platform can land on the left.
    const key = `${row.Platform}|${row.AccountID}`
    if (hiddenKeys.has(key)) continue
    if (!leftGroups.has(key)) {
      leftGroups.set(key, {
        Platform: row.Platform,
        AccountID: row.AccountID,
        AccountLabel: row.AccountLabel,
        Balance: row.Balance,
        Equity: row.Equity,
        AccountPL: row.AccountPL,
        InitialBalance: row.InitialBalance,
        MaxDailyDrawdown: row.MaxDailyDrawdown,
        MaxDailyDrawdownPct: row.MaxDailyDrawdownPct,
        TodayDrawdown: row.TodayDrawdown,
        TodayDrawdownPct: row.TodayDrawdownPct,
        MaxDrawdownAmount: row.MaxDrawdownAmount,
        MaxDrawdownPct: row.MaxDrawdownPct,
        CurrentValueAmount: row.CurrentValueAmount,
        CurrentValuePct: row.CurrentValuePct,
        ProfitTarget: row.ProfitTarget,
        symbols: new Set(),
        directions: new Set(),
        totalSize: 0,
        positionPL: 0,
        hasTakeProfit: false,
        hasStopLoss: false,
        stopLossRisk: 0,
        stopLossRiskKnown: false,
      })
    }
    const g = leftGroups.get(key)
    if (row.Symbol && row.Symbol !== "n/a") g.symbols.add(row.Symbol)
    if (row.Direction && row.Direction !== "n/a") g.directions.add(row.Direction)
    const size = toNumber(row.Size)
    if (size !== null) g.totalSize += size
    const pl = toNumber(row.PositionPL)
    if (pl !== null) g.positionPL += pl
    // "none" is every platform's sentinel for "not set" (see
    // ext-rebelsfunding/ext-ftmo/ext-alphacapital's background.js) --
    // anything else is a real price. An account with multiple open
    // positions is flagged true if ANY of them has one set, same
    // aggregate-across-positions approach as Symbol/Direction above.
    if (row.TakeProfitPrice && row.TakeProfitPrice !== "none") g.hasTakeProfit = true
    if (row.StopLossPrice && row.StopLossPrice !== "none") g.hasStopLoss = true
    // Sums this position's own dollar Stop Loss risk (see
    // stopLossRiskAmount below) into the account's total. A position whose
    // risk can't be computed (no Stop Loss set, or the price hasn't moved
    // from Opening yet) just contributes nothing to the sum -- so an
    // account with one un-computable position among several shows a total
    // that's a LOWER BOUND on its real risk, not "no risk". stopLossRiskKnown
    // tracks whether at least one position contributed, so the account-level
    // total can stay blank rather than a misleading 0 when none did.
    const risk = stopLossRiskAmount(row)
    if (risk !== null) {
      g.stopLossRisk += risk
      g.stopLossRiskKnown = true
    }
  }

  const left = [...leftGroups.values()].map((g) => ({
    Platform: g.Platform,
    AccountID: g.AccountID,
    AccountLabel: g.AccountLabel,
    Balance: g.Balance,
    Equity: g.Equity,
    AccountPL: g.AccountPL,
    InitialBalance: g.InitialBalance,
    MaxDailyDrawdown: g.MaxDailyDrawdown,
    MaxDailyDrawdownPct: g.MaxDailyDrawdownPct,
    TodayDrawdown: g.TodayDrawdown,
    TodayDrawdownPct: g.TodayDrawdownPct,
    MaxDrawdownAmount: g.MaxDrawdownAmount,
    MaxDrawdownPct: g.MaxDrawdownPct,
    CurrentValueAmount: g.CurrentValueAmount,
    CurrentValuePct: g.CurrentValuePct,
    ProfitTarget: g.ProfitTarget,
    Symbol: g.symbols.size ? [...g.symbols].join(", ") : "n/a",
    Direction: g.directions.size ? [...g.directions].join(", ") : "n/a",
    TotalSize: round2(g.totalSize),
    PositionPL: round2(g.positionPL),
    hasTakeProfit: g.hasTakeProfit,
    hasStopLoss: g.hasStopLoss,
    stopLossRisk: g.stopLossRisk,
    stopLossRiskKnown: g.stopLossRiskKnown,
  }))

  const accountLog = computeAccountLog(rows)
  const right = accountLog
    .filter((r) => !A_SIDE_PLATFORMS.has(r.Platform))
    .map((r) => ({
      Platform: r.Platform,
      AccountID: r.AccountID,
      AccountLabel: r.AccountLabel,
      Balance: r.Balance,
      Equity: r.Equity,
      AccountPL: r.AccountPL,
      Symbol: r.Symbol,
      Direction: r.Direction,
      TotalSize: r.TotalSize,
      SymbolPL: r.SymbolPL,
    }))

  // ruleMap key: "A_Platform|A_AccountID|A_Symbol" (normalized) -> target,
  // built only from rules that name a specific symbol. target carries
  // { platform, accountId, symbol, dailyDrawdown, aSymbol } for the
  // right-side row it should pair with, plus that rule's configured DD --
  // aSymbol is the rule's own (un-normalized) A-side symbol, threaded
  // through so the edit UI can tell which existing rule it would be
  // replacing.
  //
  // ruleMapByAccount key: "A_Platform|A_AccountID" -> target, built only
  // from blanket rules (no A-side symbol) -- the first fallback used when no
  // symbol-specific rule matches, most often because the account currently
  // has zero open positions (Symbol is "n/a", so the symbol-keyed lookup
  // below can't match anything). Only built from blanket rules, not "every
  // rule, last one wins" -- otherwise a symbol-specific rule for the same
  // account would incorrectly leak into this fallback slot too, now that
  // both kinds of rule can coexist for one account.
  //
  // rulesByAccount key: same, but -> ALL of that account's rules (blanket or
  // specific). Used as a second, last-resort fallback: an account with no
  // blanket rule whose only rule happens to be symbol-specific would
  // otherwise lose that rule entirely the moment its matching position
  // closes (Symbol goes to "n/a", so even the symbol-keyed lookup below
  // can't fire) -- if it's the account's ONLY rule, unambiguous, show it
  // anyway rather than hide a configured rule just because nothing's open
  // right now.
  const ruleMap = new Map()
  const ruleMapByAccount = new Map()
  const rulesByAccount = new Map()
  for (const rule of matchRules) {
    const target = {
      platform: rule.bPlatform,
      accountId: rule.bAccountId,
      symbol: normSymbol(rule.bSymbol),
      dailyDrawdown: rule.dailyDrawdown ?? null,
      note: rule.note ?? null,
      aSymbol: rule.aSymbol ?? null,
    }
    const accountKey = `${rule.aPlatform}|${rule.aAccountId}`
    if (rule.aSymbol) {
      ruleMap.set(`${accountKey}|${normSymbol(rule.aSymbol)}`, target)
    } else {
      ruleMapByAccount.set(accountKey, target)
    }
    if (!rulesByAccount.has(accountKey)) rulesByAccount.set(accountKey, [])
    rulesByAccount.get(accountKey).push(target)
  }

  // Row-level join: for each left row and each Symbol it holds (a left
  // row's Symbol can be a joined list if that account has more than one
  // open position), look up an explicit rule for that exact
  // Platform+AccountID+Symbol. If a rule exists AND its target right row is
  // present in the current data, pair them.
  const joined = []
  for (const l of left) {
    const leftSymbols = l.Symbol === "n/a" ? [] : l.Symbol.split(", ")
    let r = null
    let ruleTarget = null
    for (const sym of leftSymbols) {
      const target = ruleMap.get(`${l.Platform}|${l.AccountID}|${normSymbol(sym)}`)
      if (!target) continue
      if (!ruleTarget) ruleTarget = target
      if (!target.platform) continue // rule with no match-B-position -- Note/DD still carried via ruleTarget above
      r = right.find(
        (rr) =>
          rr.Platform === target.platform &&
          rr.AccountID === target.accountId &&
          normSymbol(rr.Symbol) === target.symbol
      )
      if (r) {
        ruleTarget = target
        break
      }
    }

    // No open position matched a rule (most often because the account has
    // no open positions at all) -- fall back to the account's blanket rule
    // so Note/DD still show, and still try the B-side pairing off the
    // rule's own symbol.
    if (!ruleTarget) {
      const accountKey = `${l.Platform}|${l.AccountID}`
      let fallback = ruleMapByAccount.get(accountKey)
      // Still nothing: if this account's only configured rule is
      // symbol-specific (no blanket rule to fall back to), show it anyway
      // rather than hide a real rule just because it's not currently open.
      if (!fallback) {
        const accountRules = rulesByAccount.get(accountKey)
        if (accountRules && accountRules.length === 1) fallback = accountRules[0]
      }
      if (fallback) {
        ruleTarget = fallback
        if (fallback.platform) {
          r = right.find(
            (rr) =>
              rr.Platform === fallback.platform &&
              rr.AccountID === fallback.accountId &&
              normSymbol(rr.Symbol) === fallback.symbol
          )
        }
      }
    }
    // InitialBalance + A_ProfitTarget (A Target PL) -- the account's equity
    // once it hits its profit target. Blank if either side is
    // missing/non-numeric (e.g. no InitialBalance scraped yet).
    const targetEquity = addMoney(l.InitialBalance, l.ProfitTarget)
    // (A_Equity - InitialBalance) / A_ProfitTarget as a percentage -- how
    // much of the profit target has been realized so far. Blank if any side
    // is missing/non-numeric or A_ProfitTarget is 0. Computed ahead of the
    // push below so it can also feed A_PLPctWarning.
    const plPct = pctOf(subMoney(l.Equity, l.InitialBalance), l.ProfitTarget)
    // Computed ahead of the push below so it can also feed A_TPSLWarning --
    // once Daily DD is already flagged, a missing Stop Loss is a bigger
    // deal than usual, so that same warning state widens what counts as a
    // TP/SL problem (see A_TPSLWarning below).
    const dailyDrawdownWarning = isRatioWarning(l.MaxDailyDrawdown, l.TodayDrawdown, warningDailyDrawdownPct)
    // No open position at all (A_Symbol is "n/a") -- suppress every
    // highlightIf-driven warning for this row rather than let stale
    // account-level numbers (last known Balance/Equity/DD figures, still
    // carried on the account even with nothing open) flag it. Most
    // visible on A_TPSLWarning, which would otherwise ALWAYS fire for a
    // no-position account (hasTakeProfit/hasStopLoss are both false with
    // nothing open) even though there's no position to have a TP/SL on.
    const hasOpenPosition = l.Symbol !== "n/a"
    joined.push({
      A_Platform: l.Platform,
      A_AccountID: l.AccountID,
      A_AccountLabel: l.AccountLabel,
      A_Balance: l.Balance,
      A_Equity: l.Equity,
      A_ProfitTarget: l.ProfitTarget || "",
      A_TargetEquity: targetEquity,
      A_PLPct: plPct,
      A_AccountPL: l.AccountPL,
      A_Symbol: l.Symbol,
      A_Direction: l.Direction,
      A_TotalSize: l.TotalSize,
      // "TP/SL" if the account has at least one open position with both a
      // Take Profit and a Stop Loss set, "TP"/"SL" if only one of the two,
      // "" if neither -- see hasTakeProfit/hasStopLoss above.
      A_TPSL: tpSlLabel(l.hasTakeProfit, l.hasStopLoss),
      // Flags the TP/SL cell for a warning two ways: (a) neither a Take
      // Profit nor a Stop Loss is set at all, or (b) a Stop Loss
      // specifically is missing WHILE Daily DD is already flagged -- once
      // today's drawdown is closing in on the daily limit, an account with
      // no Stop Loss (even one with a Take Profit set) is a real risk, not
      // just a missing-both-brackets housekeeping nit.
      A_TPSLWarning: hasOpenPosition && ((!l.hasTakeProfit && !l.hasStopLoss) || (dailyDrawdownWarning && !l.hasStopLoss)),
      // Dollar amount at risk across this account's open position(s) if
      // every set Stop Loss were hit -- see stopLossRiskAmount below.
      // Blank (not 0) when it can't be computed for ANY open position, and
      // a lower bound (not the true total) when it's a mix of computable
      // and un-computable positions -- see the accumulation comment above.
      A_StopLossRiskAmount: l.stopLossRiskKnown ? round2(l.stopLossRisk) : "",
      // Same figure as a % of the account's Balance -- "how much of this
      // account is on the line if every stop hits", comparable across
      // accounts/symbols the same way A PL % is, unlike a raw $ amount.
      A_StopLossRiskPct: l.stopLossRiskKnown ? pctOf(l.stopLossRisk, l.Balance) : "",
      A_MaxDailyDrawdown: l.MaxDailyDrawdown || "",
      // The platform's OWN Max Daily Drawdown %/Today's Drawdown % (as
      // scraped verbatim -- see MaxDailyDrawdownPct/TodayDrawdownPct in
      // ext-rebelsfunding/background.js), NOT the same ratio
      // A_DailyDrawdownWarning uses below (Today's Drawdown / Max Daily
      // Drawdown vs. the configured threshold) -- RebelsFunding's own %
      // is Today's Drawdown / Today's Starting Equity, a different
      // denominator. Shown as-is for reference; no highlightIf of its own.
      A_MaxDailyDrawdownPct: l.MaxDailyDrawdownPct || "",
      A_TodayDrawdown: l.TodayDrawdown || "",
      A_TodayDrawdownPct: l.TodayDrawdownPct || "",
      A_MaxDrawdownAmount: l.MaxDrawdownAmount || "",
      A_MaxDrawdownPct: l.MaxDrawdownPct || "",
      A_CurrentValueAmount: l.CurrentValueAmount || "",
      A_CurrentValuePct: l.CurrentValuePct || "",
      // Flags the Max Daily DD/Cur Daily DD cells for a visual warning once
      // today's realized drawdown reaches the configured % of the
      // platform's own daily limit -- an early heads-up well before the
      // account is actually at risk of breaching it.
      A_DailyDrawdownWarning: hasOpenPosition && dailyDrawdownWarning,
      // Same idea, but for the contest-wide Max DD/Cur DD cells -- flags
      // once cumulative drawdown reaches the configured % of the overall
      // (not just daily) drawdown limit.
      A_MaxDrawdownWarning: hasOpenPosition && isRatioWarning(l.MaxDrawdownAmount, l.CurrentValueAmount, warningDrawdownPct),
      // Flags the A Target PL/A Account PL cells once current profit
      // (AccountPL) reaches the configured % of the account's Profit
      // Target -- an early heads-up that the account is closing in on
      // passing its challenge. Same ratio check as the two drawdown
      // warnings above, just applied to a "getting close to a goal"
      // pairing instead of a "getting close to a limit" one.
      A_TargetProfitWarning: hasOpenPosition && isRatioWarning(l.ProfitTarget, l.AccountPL, warningTargetProfitPct),
      // Flags just the A PL % cell once A_PLPct itself reaches the
      // configured % -- a direct value-vs-threshold check (A_PLPct is
      // already a percentage), unlike the ratio-of-two-amounts checks above.
      A_PLPctWarning: hasOpenPosition && isPctWarning(plPct, warningTargetProfitPct),
      A_PositionPL: l.PositionPL,
      Note: ruleTarget && ruleTarget.note !== null ? ruleTarget.note : "",
      B_Platform: r ? r.Platform : "",
      B_AccountID: r ? r.AccountID : "",
      B_AccountLabel: r ? r.AccountLabel : "",
      B_Balance: r ? r.Balance : "",
      B_Equity: r ? r.Equity : "",
      B_AccountPL: r ? r.AccountPL : "",
      B_Symbol: r ? r.Symbol : "",
      B_Direction: r ? r.Direction : "",
      B_TotalSize: r ? r.TotalSize : "",
      B_SymbolPL: r ? r.SymbolPL : "",
      // Not rendered as a table column -- consumed by the edit form to know
      // which existing rule (symbol-specific, blanket, or none) it would be
      // replacing on save. `null` means a blanket rule matched (or none did
      // -- see hasRule); `undefined` is never stored, only used as "absent"
      // when read from a plain object without this key.
      _rule: ruleTarget
        ? { aSymbol: ruleTarget.aSymbol, bPlatform: ruleTarget.platform, bAccountId: ruleTarget.accountId, bSymbol: ruleTarget.symbol }
        : null,
      _openSymbols: leftSymbols,
    })
  }

  return { left, right, joined }
}

function normSymbol(s) {
  return (s || "").trim().toUpperCase()
}

function tpSlLabel(hasTakeProfit, hasStopLoss) {
  if (hasTakeProfit && hasStopLoss) return "TP/SL"
  if (hasTakeProfit) return "TP"
  if (hasStopLoss) return "SL"
  return ""
}

// Dollar Stop Loss risk for ONE PositionLog row -- how much this position
// would lose if price reached its StopLossPrice. Derives an implied
// $-per-price-unit rate from the position's own live numbers (PositionPL /
// (Latest - Opening)) rather than a per-symbol pip-size/contract-size
// lookup table: that rate already reflects whatever the platform actually
// pays per unit of price movement for this exact position (contract size,
// leverage, even quote-currency conversion), so applying it to the
// distance from Opening to StopLossPrice gives an exact dollar figure with
// no maintenance burden as new symbols get traded. Both differences are
// abs()'d, so the result is a magnitude regardless of Direction (Buy vs
// Sell) or whether the Stop Loss happens to be configured on the "wrong"
// side of Opening.
//
// Returns null (not computable, not "no risk") when: no Stop Loss is set;
// Opening/Latest/StopLossPrice/PositionPL aren't all present and numeric;
// or Latest === Opening -- the position hasn't moved from its entry price
// yet, so the $-per-price-unit rate is an undefined 0/0. That last case is
// usually just a snapshot taken right after the position opened, and
// resolves itself on the next scrape once price has moved at all.
function stopLossRiskAmount(row) {
  if (!row.StopLossPrice || row.StopLossPrice === "none") return null
  const opening = toNumber(row.Opening)
  const latest = toNumber(row.Latest)
  const stopLoss = toNumber(row.StopLossPrice)
  const positionPL = toNumber(row.PositionPL)
  if (opening === null || latest === null || stopLoss === null || positionPL === null) return null
  const priceMove = latest - opening
  if (priceMove === 0) return null
  const dollarPerPriceUnit = positionPL / priceMove
  return Math.abs(dollarPerPriceUnit) * Math.abs(opening - stopLoss)
}

// Shared by A_DailyDrawdownWarning (Max Daily DD/Cur Daily DD, driven by
// "Warning Daily Drawdown %"), A_MaxDrawdownWarning (contest-wide Max
// DD/Cur DD, driven by "Warning Drawdown %"), and A_TargetProfitWarning (A
// Target/A Account PL, driven by "Warning Target Profit %") -- same
// ratio-vs-threshold check, just fed each pair's own max/current amounts
// and its own independently configurable threshold.
function addMoney(a, b) {
  const x = toNumber(a)
  const y = toNumber(b)
  if (x === null || y === null) return ""
  return round2(x + y)
}

function subMoney(a, b) {
  const x = toNumber(a)
  const y = toNumber(b)
  if (x === null || y === null) return ""
  return round2(x - y)
}

function pctOf(numerator, denominator) {
  const n = toNumber(numerator)
  const d = toNumber(denominator)
  if (n === null || d === null || d === 0) return ""
  return round2((n / d) * 100)
}

function isRatioWarning(maxAmount, currentAmount, thresholdPct) {
  const max = toNumber(maxAmount)
  const current = toNumber(currentAmount)
  if (max === null || current === null || max <= 0) return false
  return current / max >= thresholdPct / 100
}

// Direct value-vs-threshold check for a value that's already a percentage
// (e.g. A_PLPct), unlike isRatioWarning above which derives a ratio from two
// raw amounts.
function isPctWarning(pctValue, thresholdPct) {
  const p = toNumber(pctValue)
  if (p === null) return false
  return p >= thresholdPct
}

export function formatMoney(value) {
  const n = toNumber(value)
  if (n === null) return value ?? ""
  const formatted = Math.round(Math.abs(n)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return n < 0 ? `-${formatted}` : formatted
}

// Up to 1 decimal place, trailing zero trimmed, and appends "%" -- e.g.
// 5 -> "5%", 1.7 -> "1.7%", -54.18 -> "-54.2%" (rounds to 1 place first,
// then drops the decimal entirely when it's not meaningful, i.e. ".0").
// Used for every `pct: true` column (A_PLPct, A_MaxDailyDrawdownPct,
// A_TodayDrawdownPct, A_StopLossRiskPct).
export function formatPct(value) {
  const n = toNumber(value)
  if (n === null) return value ?? ""
  return `${parseFloat(n.toFixed(1))}%`
}
