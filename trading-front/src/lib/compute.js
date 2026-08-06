// Client-side roll-up of the raw PositionLog rows into an AccountLog view
// (one row per Platform+AccountID+Symbol).

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
 */
export function computeMainView(rows, matchRules = []) {
  const leftGroups = new Map()
  for (const row of rows) {
    if (!A_SIDE_PLATFORMS.has(row.Platform)) continue
    // Keyed by Platform+AccountID, not AccountID alone, since more than one
    // platform can land on the left.
    const key = `${row.Platform}|${row.AccountID}`
    if (!leftGroups.has(key)) {
      leftGroups.set(key, {
        Platform: row.Platform,
        AccountID: row.AccountID,
        AccountLabel: row.AccountLabel,
        Balance: row.Balance,
        Equity: row.Equity,
        AccountPL: row.AccountPL,
        symbols: new Set(),
        directions: new Set(),
        totalSize: 0,
        positionPL: 0,
      })
    }
    const g = leftGroups.get(key)
    if (row.Symbol && row.Symbol !== "n/a") g.symbols.add(row.Symbol)
    if (row.Direction && row.Direction !== "n/a") g.directions.add(row.Direction)
    const size = toNumber(row.Size)
    if (size !== null) g.totalSize += size
    const pl = toNumber(row.PositionPL)
    if (pl !== null) g.positionPL += pl
  }

  const left = [...leftGroups.values()].map((g) => ({
    Platform: g.Platform,
    AccountID: g.AccountID,
    AccountLabel: g.AccountLabel,
    Balance: g.Balance,
    Equity: g.Equity,
    AccountPL: g.AccountPL,
    Symbol: g.symbols.size ? [...g.symbols].join(", ") : "n/a",
    Direction: g.directions.size ? [...g.directions].join(", ") : "n/a",
    TotalSize: round2(g.totalSize),
    PositionPL: round2(g.positionPL),
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

  // ruleMap key: "A_Platform|A_AccountID|A_Symbol" (normalized) ->
  // { platform, accountId, symbol, stopLoss, takeProfit } of the right-side
  // row it should pair with, plus that rule's configured SL/TP.
  //
  // ruleMapByAccount is the same targets keyed only by "A_Platform|
  // A_AccountID" (one entry per account, since config.json never defines
  // two rules for the same account) -- the fallback used when the account
  // currently has zero open positions, so its Symbol is "n/a" and the
  // symbol-keyed lookup below can't match anything. Without this, an
  // account with no open trades would lose its configured SL/TP entirely
  // just because there's nothing open to match a symbol against.
  const ruleMap = new Map()
  const ruleMapByAccount = new Map()
  for (const rule of matchRules) {
    const target = {
      platform: rule.bPlatform,
      accountId: rule.bAccountId,
      symbol: normSymbol(rule.bSymbol),
      stopLoss: rule.stopLoss ?? null,
      takeProfit: rule.takeProfit ?? null,
    }
    ruleMap.set(`${rule.aPlatform}|${rule.aAccountId}|${normSymbol(rule.aSymbol)}`, target)
    ruleMapByAccount.set(`${rule.aPlatform}|${rule.aAccountId}`, target)
  }

  // Row-level join: for each left row and each Symbol it holds (a left
  // row's Symbol can be a joined list if that account has more than one
  // open position), look up an explicit rule for that exact
  // Platform+AccountID+Symbol. If a rule exists AND its target right row is
  // present in the current data, pair them. SL/TP show whenever a rule
  // exists for the row, even with no B-side match -- they're the
  // configured thresholds for that pairing, not derived from live B-side
  // data.
  const joined = []
  for (const l of left) {
    const leftSymbols = l.Symbol === "n/a" ? [] : l.Symbol.split(", ")
    let r = null
    let ruleTarget = null
    for (const sym of leftSymbols) {
      const target = ruleMap.get(`${l.Platform}|${l.AccountID}|${normSymbol(sym)}`)
      if (!target) continue
      if (!ruleTarget) ruleTarget = target
      if (!target.platform) continue // rule with no match-B-position -- SL/TP still carried via ruleTarget above
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
    // no open positions at all) -- fall back to the account's rule so SL/TP
    // still show, and still try the B-side pairing off the rule's own
    // symbol.
    if (!ruleTarget) {
      const fallback = ruleMapByAccount.get(`${l.Platform}|${l.AccountID}`)
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
    joined.push({
      A_Platform: l.Platform,
      A_AccountID: l.AccountID,
      A_AccountLabel: l.AccountLabel,
      A_Balance: l.Balance,
      A_Equity: l.Equity,
      A_AccountPL: l.AccountPL,
      A_Symbol: l.Symbol,
      A_Direction: l.Direction,
      A_TotalSize: l.TotalSize,
      A_PositionPL: l.PositionPL,
      SL: ruleTarget && ruleTarget.stopLoss !== null ? ruleTarget.stopLoss : "",
      TP: ruleTarget && ruleTarget.takeProfit !== null ? ruleTarget.takeProfit : "",
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
    })
  }

  return { left, right, joined }
}

function normSymbol(s) {
  return (s || "").trim().toUpperCase()
}

export function formatMoney(value) {
  const n = toNumber(value)
  if (n === null) return value ?? ""
  const formatted = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n < 0 ? `-${formatted}` : formatted
}
