// Union of the CSVs ext-server/server.js produces, merged client-side in
// usePositionLog.js -- keep in sync if any platform's schema changes.
// IsRealMoney is deliberately not listed here even though the underlying
// CSVs still have it -- not displayed in the dashboard.
export const POSITIONLOG_FIELDS = [
  "SnapshotDate",
  "Platform",
  "AccountID",
  "AccountLabel",
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
