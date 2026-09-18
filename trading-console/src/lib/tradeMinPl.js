import configData from "../data-fact/config.json"

export const DEFAULT_TRADE_MIN_PL_PCT = 0.5

/**
 * "Trade Min PL %" -- the |P/L %| threshold
 * ext-rebelsfunding/background.js uses when counting a RebelsFunding
 * account's Closed Trades toward "A Trades" (a closed trade at or below
 * this threshold is treated as a scratch/near-zero close and not counted;
 * see that file's fnFetchTradeMinPlPct). From data-fact/config.json's
 * top-level "trade-min-pl-pct" number.
 *
 * This file's own read of it is NOT what drives that count -- the
 * extension is a separate browser context (a service worker, not this
 * page) with no access to this module or this page's state at all, so it
 * fetches config.json's runtime mirror straight over the network itself,
 * independently, once per scan. This parser exists only so SettingsPage's
 * "Trade Min PL %" field has something to show/edit here in the dashboard,
 * same as parseHiddenAccounts/parseMatchRules exist for their own fields --
 * see useConfigView.js, which re-fetches (and re-parses via this same
 * function) every time config.json changes, so the field stays in sync
 * with whatever the extension is actually using.
 */
export function parseTradeMinPlPct(json) {
  const n = Number(json?.["trade-min-pl-pct"])
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TRADE_MIN_PL_PCT
}

export const tradeMinPlPct = parseTradeMinPlPct(configData)
