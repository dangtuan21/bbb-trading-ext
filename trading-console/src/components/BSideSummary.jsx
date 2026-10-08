import { A_SIDE_PLATFORMS } from "../lib/compute"

function toNumber(value) {
  const n = parseFloat(value)
  return Number.isNaN(n) ? null : n
}

// Own $ formatter, not compute.js's formatMoney -- that one rounds to whole
// dollars (fine for account balances elsewhere in the app), but tastyfx's
// own account strip shows cents (see the picture Tuan attached: "$5,086.81",
// "-$104.96"), and these numbers already come off the wire as fmt2'd
// 2-decimal strings (see ext-server's buildTastyfxRows), so this keeps that
// precision instead of throwing it away.
function fmtUsd(value) {
  const n = toNumber(value)
  if (n === null) return "–"
  const formatted = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n < 0 ? `-$${formatted}` : `$${formatted}`
}

// One entry per non-A-side Platform+AccountID, carrying that account's own
// summary strip (Funds/Profit-Loss/Margin/Available/Cash Rebate) --
// currently tastyfx-only (see ext-server/server.js's buildTastyfxRows);
// any other B-side platform would just show blanks for Margin/Available/
// CashRebate since nothing scrapes those for it. These are whole-account
// figures, identical across every PositionLog row for that account at a
// given snapshot (not per-position), so the first row seen for each
// account is as good as any to read them off of -- no summing, just dedup.
// Includes a flat account (Symbol "n/a") same as one with open positions --
// see buildTastyfxRows' placeholder-row comment for why a flat account
// still has a row to be found here at all.
function computeBSideAccounts(rows) {
  const seen = new Map()
  for (const row of rows) {
    if (A_SIDE_PLATFORMS.has(row.Platform)) continue
    const key = `${row.Platform}|${row.AccountID}`
    if (seen.has(key)) continue
    seen.set(key, {
      Platform: row.Platform,
      AccountID: row.AccountID,
      AccountLabel: row.AccountLabel,
      Funds: row.Balance,
      ProfitLoss: row.AccountPL,
      Margin: row.Margin,
      Available: row.Available,
      CashRebate: row.CashRebate,
    })
  }
  return [...seen.values()]
}

const TILES = [
  { key: "Funds", label: "Funds" },
  { key: "ProfitLoss", label: "Profit/Loss", signColor: true },
  { key: "Margin", label: "Margin" },
  { key: "Available", label: "Available" },
  { key: "CashRebate", label: "Cash Rebate" },
]

/**
 * BSideSummary: the "B-side Chart" section on the Account Chart page --
 * not a bar chart like Daily DD Chart/Full Chart above it, but the same
 * account-summary strip tastyfx's own page header shows (Funds/Profit-
 * Loss/Margin/Available/Cash Rebate), read straight off PositionLog rather
 * than through mainView's A-side join (there's no A-side account to join
 * against here -- this is the B side's own numbers, one card per B-side
 * account). Requested by Tuan (2026-10-08) off a screenshot of that exact
 * strip. Takes the raw, unfiltered PositionLog `rows` (see
 * AccountChartsPage's own useAccountView() call) -- one card per distinct
 * B-side account, regardless of whether it currently has any open
 * positions.
 */
export default function BSideSummary({ rows }) {
  const accounts = computeBSideAccounts(rows)

  if (accounts.length === 0) {
    return <p className="text-sm text-slate-400">No B-side account data yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {accounts.map((acct) => (
        <div
          key={`${acct.Platform}|${acct.AccountID}`}
          className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm"
        >
          <div className="mb-3 text-sm font-medium text-slate-500">
            {acct.Platform}
            {acct.AccountLabel ? ` · ${acct.AccountLabel}` : ""} · {acct.AccountID}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {TILES.map((tile) => {
              const raw = acct[tile.key]
              const n = toNumber(raw)
              const negative = tile.signColor && n !== null && n < 0
              return (
                <div key={tile.key}>
                  <div className="text-xs font-medium text-slate-400">{tile.label}</div>
                  <div className={`text-lg font-semibold ${negative ? "text-red-600" : "text-slate-800"}`}>
                    {fmtUsd(raw)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
