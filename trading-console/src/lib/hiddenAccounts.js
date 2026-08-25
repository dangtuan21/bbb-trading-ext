import configData from "../data-fact/config.json"

/**
 * Accounts hidden from MainView entirely (via RuleEditForm's "Hide Account"
 * button / SettingsPage's "Unhide"), from data-fact/config.json's
 * "hidden-accounts" array. Separate from matchRules.js's position-rule
 * concept on purpose: a rule controls B-side pairing/Note for a row that
 * still shows, while this controls whether the row shows AT ALL --
 * MainView's left block is built straight from positions.csv (see
 * compute.js's computeMainView), so an account that's closed/no longer
 * traded but still has a balance/equity snapshot in the CSV would otherwise
 * keep appearing forever with no rule to un-pair.
 *
 * Shape:
 *
 *   {
 *     "hidden-accounts": ["A_Platform|A_AccountID", ...]
 *   }
 *
 * Always account-level (no Symbol segment) -- hiding is all-or-nothing for
 * the whole account, unlike a position-rule which can be symbol-specific.
 */
export function parseHiddenAccounts(json) {
  const list = json?.["hidden-accounts"]
  if (!Array.isArray(list)) return []

  const accounts = []
  for (const entry of list) {
    if (typeof entry !== "string") continue
    const [platform, accountId] = entry.split("|").map((s) => s.trim())
    if (platform && accountId) accounts.push({ platform, accountId })
  }
  return accounts
}

export const hiddenAccounts = parseHiddenAccounts(configData)
