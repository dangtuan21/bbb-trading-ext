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
        IsRealMoney: row.IsRealMoney,
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
    IsRealMoney: g.IsRealMoney,
    Balance: g.Balance,
    Equity: g.Equity,
    AccountPL: g.AccountPL,
    Symbol: g.Symbol,
    Direction: g.directions.size ? [...g.directions].join(", ") : "n/a",
    TotalSize: round2(g.totalSize),
    SymbolPL: round2(g.symbolPL),
  }))
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
