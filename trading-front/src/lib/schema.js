// Union of both CSVs ext-server/server.js produces (tastyfx.csv +
// rebelsfunding.csv, merged client-side in usePositionLog.js) -- keep in
// sync if either schema changes. IsRealMoney only comes from
// rebelsfunding.csv; tastyfx rows just show blank for it.
export const POSITIONLOG_FIELDS = [
  "SnapshotDate",
  "Platform",
  "AccountID",
  "AccountLabel",
  "IsRealMoney",
  "Balance",
  "Equity",
  "AccountPL",
  "PosID",
  "Symbol",
  "Direction",
  "Size",
  "SizeUnit",
  "Opening",
  "Latest",
  "StopLoss",
  "TakeProfit",
  "PositionPL",
]

export const MONEY_FIELDS = new Set(["Balance", "Equity", "AccountPL", "PositionPL"])

// Non-money but still numeric columns -- right-aligned like money columns,
// but shown as-is (no formatMoney, no red-on-negative).
export const NUMERIC_FIELDS = new Set([
  "Size",
  "TotalSize",
  "Opening",
  "Latest",
  "StopLoss",
  "TakeProfit",
  "SymbolPL",
])
