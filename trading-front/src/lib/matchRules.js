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
 *         "Stoploss-Takeprofit": [-100, 100]
 *       },
 *       ...
 *     ],
 *     "schedule-interval": "60m"
 *   }
 *
 * "match-B-position" is optional -- an entry with only "A-position" and
 * "Stoploss-Takeprofit" is a valid rule too, it just has no B-side pairing
 * (B_ columns stay blank in MainView, same as an unmatched rule), while
 * still carrying its SL/TP through to that A-side row.
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

    const aFields = aPart.split("|")
    if (aFields.length !== 3) continue
    const [aPlatform, aAccountId, aSymbol] = aFields.map((s) => s.trim())

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

    const slTp = entry?.["Stoploss-Takeprofit"]
    const stopLoss = Array.isArray(slTp) && typeof slTp[0] === "number" ? slTp[0] : null
    const takeProfit = Array.isArray(slTp) && typeof slTp[1] === "number" ? slTp[1] : null

    rules.push({ aPlatform, aAccountId, aSymbol, bPlatform, bAccountId, bSymbol, stopLoss, takeProfit })
  }
  return rules
}

export const matchRules = parseMatchRules(configData)
