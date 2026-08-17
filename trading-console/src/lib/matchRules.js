import configData from "../data-fact/config.json"

/**
 * MainView's explicit row-matching rules, from src/data-fact/config.json.
 * Unlike the original bbb-trading/trading-front (where this file was
 * mirrored into public/data/ by an external Python process and fetched at
 * runtime), this copy has no such process -- it's a checked-in source file,
 * so it's imported directly and parsed once at load time instead. Shape:
 *
 *   {
 *     "position-rule": [
 *       {
 *         "A-position": "A_Platform|A_AccountID|A_Symbol",
 *         "match-B-position": "B_Platform|B_AccountID|B_Symbol",
 *         "A-DailyDrawdown": -500,
 *         "Note": "free-text, optional"
 *       },
 *       ...
 *     ],
 *     "schedule-interval": "60m"
 *   }
 *
 * "match-B-position" is optional -- an entry with only "A-position" is a
 * valid rule too, it just has no B-side pairing (B_ columns stay blank in
 * MainView, same as an unmatched rule).
 *
 * "A-position"'s Symbol segment is optional too -- "A_Platform|A_AccountID"
 * (2 fields) is a blanket rule that applies to the account regardless of
 * which symbol it's trading; "A_Platform|A_AccountID|A_Symbol" (3 fields)
 * only applies to that specific symbol and takes precedence over a blanket
 * rule for the same account (see computeMainView's ruleMap vs
 * ruleMapByAccount). aSymbol is null for a blanket rule.
 *
 * "schedule-interval" isn't consumed here.
 */
export function parseMatchRules(json) {
  const rules = []
  const positionRules = json?.["position-rule"]
  if (!Array.isArray(positionRules)) return rules

  for (const entry of positionRules) {
    const aPart = entry?.["A-position"]
    if (typeof aPart !== "string") continue

    const aFields = aPart.split("|").map((s) => s.trim())
    if (aFields.length !== 2 && aFields.length !== 3) continue
    const [aPlatform, aAccountId, aSymbol = null] = aFields

    let bPlatform = null
    let bAccountId = null
    let bSymbol = null
    const bPart = entry?.["match-B-position"]
    if (typeof bPart === "string") {
      const bFields = bPart.split("|")
      if (bFields.length === 3) {
        ;[bPlatform, bAccountId, bSymbol] = bFields.map((s) => s.trim())
      }
    }

    const dd = entry?.["A-DailyDrawdown"]
    const dailyDrawdown = typeof dd === "number" ? dd : null

    const noteVal = entry?.["Note"]
    const note = typeof noteVal === "string" && noteVal ? noteVal : null

    rules.push({ aPlatform, aAccountId, aSymbol, bPlatform, bAccountId, bSymbol, dailyDrawdown, note })
  }
  return rules
}

export const matchRules = parseMatchRules(configData)
