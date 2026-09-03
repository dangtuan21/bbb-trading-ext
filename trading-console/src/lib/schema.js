// Columns of the combined positions.csv ext-server/server.js produces --
// keep in sync if any platform's schema changes. IsRealMoney is deliberately
// not listed here even though the underlying CSV still has it -- not
// displayed in the dashboard.
export const POSITIONLOG_FIELDS = [
  "SnapshotDate",
  "Platform",
  "AccountID",
  "AccountLabel",
  "Phase",
  "Balance",
  "Equity",
  "AccountPL",
  "InitialBalance",
  "StartingEquity",
  "MaxDailyDrawdown",
  "MaxDailyDrawdownPct",
  "TodayDrawdown",
  "TodayDrawdownPct",
  "MaxDrawdownAmount",
  "MaxDrawdownPct",
  "CurrentValueAmount",
  "CurrentValuePct",
  "ProfitTarget",
  "PosID",
  "Symbol",
  "Direction",
  "Size",
  "SizeUnit",
  "Opening",
  "Latest",
  "StopLossPrice",
  "TakeProfitPrice",
  "PositionPL",
]

// AccountLog's own column list -- one row per open position (see
// computeAccountLog in compute.js), so these are plain unprefixed field
// names same as PositionLog's POSITIONLOG_FIELDS above, just a narrower
// subset of them (no per-platform scrape-only fields like MaxDailyDrawdown).
export const ACCOUNTLOG_COLUMNS = [
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

export const MONEY_FIELDS = new Set([
  "Balance",
  "Equity",
  "AccountPL",
  "InitialBalance",
  "StartingEquity",
  "MaxDailyDrawdown",
  "TodayDrawdown",
  "MaxDrawdownAmount",
  "CurrentValueAmount",
  "ProfitTarget",
  "PositionPL",
])

// Non-money but still numeric columns -- right-aligned like money columns,
// but shown as-is (no formatMoney, no red-on-negative).
export const NUMERIC_FIELDS = new Set([
  "Size",
  "TotalSize",
  "Opening",
  "Latest",
  "StopLossPrice",
  "TakeProfitPrice",
  "SymbolPL",
  "MaxDailyDrawdownPct",
  "TodayDrawdownPct",
  "MaxDrawdownPct",
  "CurrentValuePct",
])
