// Zero-dependency local server shared by the TastyFX, RebelsFunding, FTMO,
// and AlphaCapital Positions Tracker extensions. One process, one port, one
// endpoint -- POST /write with a "platform" field routes to the right row
// builder, and every platform's rows are merged into a single positions.csv
// (not one file per platform) since each POST only ever carries one
// platform's snapshot, the server keeps every platform's last-known rows in
// memory and rewrites the combined file in full on each write.

const http = require('http');
const fs = require('fs');
const path = require('path');

// Pushover credentials (PUSHOVER_USER_KEY / PUSHOVER_API_TOKEN) live in this
// gitignored .env file, not in notify-config.json -- secrets belong in .env,
// non-secret tuning (thresholds, which alerts are on) stays in the JSON
// config. Loaded once, here, at startup via Node's built-in
// process.loadEnvFile (no dotenv dependency needed) -- wrapped in try/catch
// since the file won't exist yet on a fresh checkout, before .env.example
// is copied over. Editing .env later requires a server restart to take
// effect (see sendPushover's comment for why).
const ENV_FILE = path.join(__dirname, '.env');
try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // No .env yet -- sendPushover() below reports "not configured" per-call.
}

const PORT = 8765;

const PLATFORM = Object.freeze({
  TASTYFX: 'tastyfx',
  REBELSFUNDING: 'rebelsfunding',
  FTMO: 'ftmo',
  ALPHACAPITAL: 'alphacapital',
});

// Order rows appear in the combined file -- stable regardless of which
// platform wrote most recently.
const PLATFORM_ORDER = [PLATFORM.TASTYFX, PLATFORM.REBELSFUNDING, PLATFORM.FTMO, PLATFORM.ALPHACAPITAL];

// Maps the CSV's "Platform" column value (what each platform actually
// writes into its rows) back to the internal platform key above, so rows
// read back from disk at startup can be sorted into the right cache bucket.
const PLATFORM_KEY_BY_DISPLAY = {
  tastyfx: PLATFORM.TASTYFX,
  RebelsFunding: PLATFORM.REBELSFUNDING,
  FTMO: PLATFORM.FTMO,
  AlphaCapital: PLATFORM.ALPHACAPITAL,
};

const POSITIONS_FILE = path.join(__dirname, 'positions.csv');
const FRONTEND_DATA_DIR = path.join(__dirname, '..', 'trading-console', 'public', 'data');
const POSITIONS_MIRROR_FILE = path.join(FRONTEND_DATA_DIR, 'positions.csv');

// Written directly (not mirrored) -- unlike positions.csv this IS the
// checked-in source file trading-console's matchRules.js imports at build
// time, so MainView's rule-editing UI (see App.jsx) intentionally leaves an
// edit trail in `git diff` instead of living in a gitignored runtime copy.
// Vite's own dev-server file watcher picks up the on-disk change and
// reloads the page -- no separate fetch/mirror path needed for the frontend
// to see it.
const MATCH_RULES_CONFIG_FILE = path.join(__dirname, '..', 'trading-console', 'src', 'data-fact', 'config.json');

// Non-secret tuning for the warning -> phone-notification feature below
// (Pushover credentials themselves live in .env -- see ENV_FILE above, not
// here). Re-read on every check (see loadNotifyConfig) rather than cached
// at startup, so editing it takes effect without restarting the server.
// Shape:
//
//   {
//     "thresholds": {  // optional -- overrides DEFAULT_NOTIFY_THRESHOLDS below
//       "dailyDrawdownPct": 20,
//       "drawdownPct": 20,
//       "targetProfitPct": 80
//     },
//     "metrics": {      // optional -- set any to false to mute that alert
//       "dailyDrawdown": true,
//       "maxDrawdown": true,
//       "targetPL": true,
//       "plPct": true,
//       "tpsl": true    // mirrors MainView's "Warning TP/SL" highlight --
//                        // see WARNING_METRICS' tpsl entry below
//     },
//     "tiers": {        // optional -- multi-rung ladder per metric, overrides
//                        // that metric's single "thresholds" value above.
//                        // Notifies once per rung climbed through, not just
//                        // once ever -- e.g. plPct at 80%, then again at 90%,
//                        // 95%, 100% as it keeps climbing (see tierLadderFor).
//       "plPct": [80, 90, 95, 100]
//     }
//   }
const NOTIFY_CONFIG_FILE = path.join(__dirname, 'notify-config.json');

// Mirrors trading-console's src/lib/settings.js DEFAULT_WARNING_* constants.
// That file's thresholds live in the browser's localStorage (a personal
// display preference), invisible to this server, so these are an
// independent copy for the phone-alert side -- override via
// notify-config.json's "thresholds" if you tune the on-screen ones and want
// alerts to match.
const DEFAULT_NOTIFY_THRESHOLDS = {
  dailyDrawdownPct: 20,
  drawdownPct: 20,
  targetProfitPct: 80,
  // Not really a "%" like the others -- the tpsl metric's value() only ever
  // returns 100 (warning) or null (no warning), so this is just the single
  // rung that 100 needs to reach/exceed. Exists so tpsl can reuse the same
  // tier-ladder/thresholds plumbing as every other metric instead of a
  // bespoke boolean path. Override via notify-config.json if you ever add a
  // "tiers": { "tpsl": [...] } ladder, though a boolean metric has no real
  // use for more than one rung.
  tpslPct: 100,
};

function csvField(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function fmtDate(isoTimestamp) {
  const d = new Date(isoTimestamp);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getFullYear()}`;
}

function fmt2(n) {
  return typeof n === 'number' ? n.toFixed(2) : n;
}

// Union of every platform's columns. tastyfx doesn't have a concept of
// IsRealMoney -- its rows just leave that field blank. InitialBalance/
// StartingEquity/MaxDailyDrawdown/MaxDailyDrawdownPct/TodayDrawdown/
// TodayDrawdownPct/MaxDrawdownAmount/MaxDrawdownPct/CurrentValueAmount/
// CurrentValuePct/ProfitTarget are RebelsFunding-only (from RF-Trader's
// "Contest stats" tab) -- every other platform leaves them blank too.
// MaxDailyDrawdownPct/TodayDrawdownPct are the platform's OWN percentages
// (Today's Drawdown / Today's Starting Equity), captured as-is for
// reference -- NOT the same ratio the dashboard's own Daily DD warning uses
// (Today's Drawdown / Max Daily Drawdown, computed in compute.js/
// checkWarningsAndNotify below).
const HEADER = [
  'SnapshotDate', 'Platform', 'AccountID', 'AccountLabel', 'IsRealMoney',
  'Balance', 'Equity', 'AccountPL',
  'InitialBalance', 'StartingEquity', 'MaxDailyDrawdown', 'MaxDailyDrawdownPct',
  'TodayDrawdown', 'TodayDrawdownPct',
  'MaxDrawdownAmount', 'MaxDrawdownPct', 'CurrentValueAmount', 'CurrentValuePct',
  'ProfitTarget',
  'PosID', 'Symbol', 'Direction', 'Size', 'SizeUnit',
  'Opening', 'Latest', 'StopLossPrice', 'TakeProfitPrice', 'PositionPL',
];

function buildTastyfxRows({ snapshot, accountId, accountLabel }) {
  const snapshotDate = fmtDate(snapshot.timestamp);
  const balance = snapshot.account?.funds ?? null;
  const accountPL = snapshot.account?.profitloss ?? null;
  // tastyfx's account strip (Funds/Profit-Loss/Margin/Available/Cash Rebate)
  // never shows a separate "Equity" figure -- left blank rather than
  // computed as Balance+AccountPL, since that's a derived number, not
  // something actually read off the page.
  const equity = null;

  return (snapshot.positions || []).map((p) => ({
    SnapshotDate: snapshotDate,
    Platform: PLATFORM.TASTYFX,
    AccountID: accountId,
    AccountLabel: accountLabel,
    IsRealMoney: '',
    Balance: fmt2(balance),
    Equity: fmt2(equity),
    AccountPL: fmt2(accountPL),
    PosID: 'n/a',
    Symbol: p.market,
    Direction: p.size >= 0 ? 'Buy' : 'Sell',
    Size: Math.abs(p.size),
    SizeUnit: 'lot',
    Opening: p.opening,
    Latest: p.latest,
    StopLossPrice: p.stopLoss === null ? 'none' : p.stopLoss,
    TakeProfitPrice: p.takeProfit === null ? 'none' : p.takeProfit,
    PositionPL: fmt2(p.profitLossUsd),
  }));
}

// Shared by RebelsFunding, FTMO, and AlphaCapital -- all send an
// already-shaped array of rows (the extension does all scraping/shaping
// itself), unlike tastyfx which sends a raw snapshot this server transforms.
function buildPassthroughRows({ rows }) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  return rows;
}

// One entry per platform: how to build its rows from the POSTed payload, and
// how to count them for the log line / response.
const PLATFORM_CONFIG = {
  [PLATFORM.TASTYFX]: {
    build: buildTastyfxRows,
    countRows: (payload) => payload.snapshot.positions?.length ?? 0,
  },
  [PLATFORM.REBELSFUNDING]: {
    build: buildPassthroughRows,
    countRows: (payload) => payload.rows.length,
  },
  [PLATFORM.FTMO]: {
    build: buildPassthroughRows,
    countRows: (payload) => payload.rows.length,
  },
  [PLATFORM.ALPHACAPITAL]: {
    build: buildPassthroughRows,
    countRows: (payload) => payload.rows.length,
  },
};

// In-memory cache of each platform's last-known rows -- a POST only ever
// carries one platform's snapshot, so this is what lets the combined file
// keep every other platform's rows intact across writes.
const platformRows = {
  [PLATFORM.TASTYFX]: [],
  [PLATFORM.REBELSFUNDING]: [],
  [PLATFORM.FTMO]: [],
  [PLATFORM.ALPHACAPITAL]: [],
};

// Minimal CSV parsing (quoted fields, escaped quotes, no embedded newlines
// inside a field beyond what csvField above ever produces) -- just enough to
// read positions.csv back on startup, since this server stays
// zero-dependency rather than pulling in a CSV library for one read.
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

function loadExistingPositions() {
  let text;
  try {
    text = fs.readFileSync(POSITIONS_FILE, 'utf8');
  } catch {
    return;
  }
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return;
  const header = parseCsvLine(lines[0]);

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((key, idx) => { row[key] = fields[idx] ?? ''; });
    // One-time migration for a positions.csv written before StopLoss/
    // TakeProfit were renamed to StopLossPrice/TakeProfitPrice -- an old
    // file's header still has the old names, so `row` comes out of the
    // loop above keyed by those. Without this, every row loaded from disk
    // at startup would show blank StopLossPrice/TakeProfitPrice cells (the
    // new HEADER's column names) until each platform gets rescraped and
    // overwrites it. Safe to run unconditionally -- a no-op once the file
    // itself has been rewritten with the new header.
    if ('StopLoss' in row && !('StopLossPrice' in row)) row.StopLossPrice = row.StopLoss;
    if ('TakeProfit' in row && !('TakeProfitPrice' in row)) row.TakeProfitPrice = row.TakeProfit;
    const platformKey = PLATFORM_KEY_BY_DISPLAY[row.Platform];
    if (platformKey) platformRows[platformKey].push(row);
  }
}

function buildCombinedCsv() {
  const lines = [HEADER.join(',')];
  for (const platformKey of PLATFORM_ORDER) {
    for (const row of platformRows[platformKey]) {
      lines.push(HEADER.map((key) => csvField(row[key])).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

function writeCombined() {
  const csv = buildCombinedCsv();
  fs.writeFileSync(POSITIONS_FILE, csv);
  try {
    fs.mkdirSync(path.dirname(POSITIONS_MIRROR_FILE), { recursive: true });
    fs.writeFileSync(POSITIONS_MIRROR_FILE, csv);
  } catch (err) {
    console.warn('Could not mirror to trading-console:', err.message);
  }
}

// Finds the index of the position-rule entry matching a given A-side
// Platform+AccountID+symbol, where symbol === null means "the blanket rule
// for this account" (an "A-position" with no third segment) rather than
// "any rule for this account" -- a symbol-specific and a blanket rule can
// coexist for the same account, so this must distinguish them exactly the
// same way trading-console's matchRules.js parses "A-position".
function findRuleIndex(rules, platform, accountId, symbol) {
  return rules.findIndex((entry) => {
    const parts = String(entry?.['A-position'] || '').split('|').map((s) => s.trim());
    if (parts.length !== 2 && parts.length !== 3) return false;
    if (parts[0] !== platform || parts[1] !== accountId) return false;
    const entrySymbol = parts.length === 3 && parts[2] ? parts[2] : null;
    return entrySymbol === symbol;
  });
}

// Builds/replaces one position-rule entry from a MainView edit and writes
// the config file back in place. `originalASymbol` (string | null |
// undefined) identifies which existing entry this edit replaces: a string
// or null means "replace the entry with this exact A-side symbol (null =
// blanket)"; omitting the field entirely means "no existing entry -- this
// is a brand new rule, just append it."
function applyRuleEdit(payload) {
  const raw = fs.readFileSync(MATCH_RULES_CONFIG_FILE, 'utf8');
  const configJson = JSON.parse(raw);
  if (!Array.isArray(configJson['position-rule'])) configJson['position-rule'] = [];
  const rules = configJson['position-rule'];

  const aSymbol = payload.aSymbol || null;
  const aPosition = aSymbol
    ? `${payload.aPlatform}|${payload.aAccountId}|${aSymbol}`
    : `${payload.aPlatform}|${payload.aAccountId}`;

  const entry = { 'A-position': aPosition };
  if (payload.bPlatform && payload.bAccountId && payload.bSymbol) {
    entry['match-B-position'] = `${payload.bPlatform}|${payload.bAccountId}|${payload.bSymbol}`;
  }
  if (typeof payload.dailyDrawdown === 'number') {
    entry['A-DailyDrawdown'] = payload.dailyDrawdown;
  }
  if (typeof payload.note === 'string' && payload.note) {
    entry['Note'] = payload.note;
  }

  const hasOriginal = Object.prototype.hasOwnProperty.call(payload, 'originalASymbol');
  const idx = hasOriginal
    ? findRuleIndex(rules, payload.aPlatform, payload.aAccountId, payload.originalASymbol ?? null)
    : -1;
  if (idx >= 0) {
    rules[idx] = entry;
  } else {
    rules.push(entry);
  }

  fs.writeFileSync(MATCH_RULES_CONFIG_FILE, formatConfigJson(configJson));
}

// Removes one position-rule entry entirely (RuleEditForm's "Delete" button).
// `payload.aSymbol` (string | null) identifies the entry the same way
// applyRuleEdit's originalASymbol does -- null means the account's blanket
// rule, a string means that exact symbol-specific rule. Throws if no such
// entry exists, same "let the caller's catch block report it" convention as
// the rest of this file's config helpers.
function deleteRule(payload) {
  const raw = fs.readFileSync(MATCH_RULES_CONFIG_FILE, 'utf8');
  const configJson = JSON.parse(raw);
  if (!Array.isArray(configJson['position-rule'])) configJson['position-rule'] = [];
  const rules = configJson['position-rule'];

  const idx = findRuleIndex(rules, payload.aPlatform, payload.aAccountId, payload.aSymbol ?? null);
  if (idx < 0) throw new Error('No matching rule found to delete');
  rules.splice(idx, 1);

  fs.writeFileSync(MATCH_RULES_CONFIG_FILE, formatConfigJson(configJson));
}

// Adds/removes one "Platform|AccountID" key from config.json's
// "hidden-accounts" array (RuleEditForm's "Hide Account" button / Settings'
// "Unhide" button) -- fully excludes that account from MainView's left
// block (see trading-console's computeMainView/hiddenAccounts.js), separate
// from and independent of any position-rule entry for it. Idempotent
// either way: hiding an already-hidden account, or unhiding one that isn't
// hidden, is a silent no-op rather than an error.
function setAccountHidden(payload) {
  const raw = fs.readFileSync(MATCH_RULES_CONFIG_FILE, 'utf8');
  const configJson = JSON.parse(raw);
  const key = `${payload.aPlatform}|${payload.aAccountId}`;
  const existing = Array.isArray(configJson['hidden-accounts']) ? configJson['hidden-accounts'] : [];
  const set = new Set(existing);
  if (payload.hidden) set.add(key);
  else set.delete(key);
  configJson['hidden-accounts'] = [...set];

  fs.writeFileSync(MATCH_RULES_CONFIG_FILE, formatConfigJson(configJson));
}

// JSON.stringify(_, null, 4) explodes every array onto its own lines, which
// would turn a one-rule edit into a diff touching every rule in the file --
// the opposite of the point of writing straight to the checked-in file.
// Collapses short number-only arrays back onto one line after the fact.
// Nothing in the current rule shape uses an array anymore, but this stays
// generic/harmless in case a future field does.
function formatConfigJson(obj) {
  const json = JSON.stringify(obj, null, 4);
  return json.replace(/\[\n\s*(-?\d+(?:\.\d+)?(?:,\n\s*-?\d+(?:\.\d+)?)*)\n\s*\]/g, (_match, nums) => {
    const compact = nums.split(',').map((n) => n.trim()).join(', ');
    return `[${compact}]`;
  }) + '\n';
}

// ---------------------------------------------------------------------------
// Warning -> Pushover phone notifications.
//
// Each of the four warning conditions MainView highlights (see
// trading-console's compute.js) is checked against a "tier ladder" -- an
// ascending list of percentages (e.g. plPct's default [80]) -- and fires
// once each time the metric's current value climbs past a rung it hadn't
// already passed, not on every /write while it stays at the same rung. A
// metric with multiple rungs (set via notify-config.json's "tiers", e.g.
// plPct: [80, 90, 95, 100]) re-notifies as it climbs through each one, so a
// profit target you're closing in on keeps you posted instead of going
// quiet after the first alert. The "highest rung already notified" state
// is tracked in-memory only (tierState below), so it resets on server
// restart -- a metric already past its first rung will notify once more
// right after a restart. Acceptable for a personal local tool; if that ever
// becomes annoying, persist tierState to a small JSON file the same way
// positions.csv is persisted.
// ---------------------------------------------------------------------------

// Platforms treated as the "A" side, same set as compute.js's
// A_SIDE_PLATFORMS -- these are the accounts MainView's warning columns
// apply to.
const NOTIFY_A_SIDE_PLATFORMS = new Set(['RebelsFunding', 'AlphaCapital', 'FTMO']);

function loadNotifyConfig() {
  try {
    return JSON.parse(fs.readFileSync(NOTIFY_CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function toNum(value) {
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

// Same ratio math as trading-console's src/lib/compute.js (isRatioWarning)
// rather than imported -- that file is an ES module consumed by the Vite
// frontend, this server is plain CommonJS. Keep both in sync by hand if the
// warning math ever changes. Returns the raw percentage (not a boolean) so
// checkWarningsAndNotify can compare it against a tier ladder rather than a
// single threshold.
function ratioPct(currentAmount, maxAmount) {
  const max = toNum(maxAmount);
  const current = toNum(currentAmount);
  if (max === null || current === null || max <= 0) return null;
  return (current / max) * 100;
}

function ratioPctLabel(currentAmount, maxAmount) {
  const p = ratioPct(currentAmount, maxAmount);
  return p === null ? 'n/a' : `${Math.round(p)}%`;
}

// A_PLPct from compute.js: (Equity - InitialBalance) / ProfitTarget, as a
// percentage. Returns null (not a warning) if any input is missing/0.
function plPctFor(row) {
  const equity = toNum(row.Equity);
  const initialBalance = toNum(row.InitialBalance);
  const target = toNum(row.ProfitTarget);
  if (equity === null || initialBalance === null || target === null || target === 0) return null;
  return ((equity - initialBalance) / target) * 100;
}

// Same rule as trading-console's compute.js A_TPSLWarning: flag the account
// if (a) neither a Take Profit nor a Stop Loss is set on any open position,
// or (b) a Stop Loss specifically is missing while Daily Drawdown is
// already at/above its own configured threshold -- a Take Profit alone
// doesn't cover that risk. Returns a plain boolean; the tpsl metric below
// turns that into 100/null so it can reuse the same tier-ladder machinery
// as every ratio-based metric.
function tpslWarning(row, thresholds) {
  const noTpNoSl = !row._hasTakeProfit && !row._hasStopLoss;
  const dailyDrawdownPct = ratioPct(row.TodayDrawdown, row.MaxDailyDrawdown);
  const dailyDrawdownWarning = dailyDrawdownPct !== null && dailyDrawdownPct >= thresholds.dailyDrawdownPct;
  return noTpNoSl || (dailyDrawdownWarning && !row._hasStopLoss);
}

// One entry per warning MainView can highlight. `priority`/`sound` are
// Pushover fields (https://pushover.net/api#priority, #sounds) -- the two
// drawdown (risk) alerts default louder/more urgent than the two
// profit-target (good news) ones. Toggle any of these off via
// notify-config.json's "metrics" without touching this code.
//
// `value(row)` returns the metric's current percentage (or null if not
// computable) -- checkWarningsAndNotify compares it against a tier ladder
// (see tierLadderFor) rather than a single threshold, so a metric can climb
// through several rungs (e.g. plPct at 80%, 90%, 95%, 100%) and notify once
// per rung crossed, instead of only once ever. A metric with no "tiers"
// override in notify-config.json just gets a single-rung ladder from
// `thresholds[thresholdKey]`, which reproduces the old once-only behavior.
//
// `message(row, tierPct)` describes the specific rung just crossed --
// tierPct is that rung's threshold (e.g. 90), not the metric's live value.
const WARNING_METRICS = [
  {
    key: 'dailyDrawdown',
    thresholdKey: 'dailyDrawdownPct',
    label: 'Daily Drawdown',
    priority: 1,
    sound: 'siren',
    value: (row) => ratioPct(row.TodayDrawdown, row.MaxDailyDrawdown),
    message: (row, tierPct) =>
      `Today's Drawdown $${row.TodayDrawdown} has crossed ${tierPct}% of Max Daily Drawdown $${row.MaxDailyDrawdown} (now ${ratioPctLabel(row.TodayDrawdown, row.MaxDailyDrawdown)}).`,
  },
  {
    key: 'maxDrawdown',
    thresholdKey: 'drawdownPct',
    label: 'Max Drawdown',
    priority: 1,
    sound: 'siren',
    value: (row) => ratioPct(row.CurrentValueAmount, row.MaxDrawdownAmount),
    message: (row, tierPct) =>
      `Current Value $${row.CurrentValueAmount} has crossed ${tierPct}% of Max Drawdown $${row.MaxDrawdownAmount} (now ${ratioPctLabel(row.CurrentValueAmount, row.MaxDrawdownAmount)}).`,
  },
  {
    key: 'targetPL',
    thresholdKey: 'targetProfitPct',
    label: 'Target PL',
    priority: 0,
    sound: 'magic',
    value: (row) => ratioPct(row.AccountPL, row.ProfitTarget),
    message: (row, tierPct) =>
      `Account PL $${row.AccountPL} has crossed ${tierPct}% of Profit Target $${row.ProfitTarget} (now ${ratioPctLabel(row.AccountPL, row.ProfitTarget)}).`,
  },
  {
    key: 'plPct',
    thresholdKey: 'targetProfitPct',
    label: 'PL %',
    priority: 0,
    sound: 'magic',
    value: (row) => plPctFor(row),
    message: (row, tierPct) => {
      const p = plPctFor(row);
      return `Equity-based PL has crossed ${tierPct}% of Profit Target (now ${p === null ? 'n/a' : Math.round(p) + '%'}).`;
    },
  },
  {
    // Mirrors MainView's "Warning TP/SL" blinking highlight (see
    // compute.js's A_TPSLWarning) -- a boolean condition, not a
    // percentage-vs-limit ratio like the four metrics above, so value()
    // just returns 100 (warning) or null (no warning) against a fixed
    // single-rung ladder ([thresholds.tpslPct], default 100). Still gets
    // the same transition-only behavior as every other metric: notifies
    // once when the condition first becomes true, stays quiet while it
    // remains true, and re-arms if it clears and reappears later.
    key: 'tpsl',
    thresholdKey: 'tpslPct',
    label: 'TP/SL',
    priority: 1,
    sound: 'siren',
    value: (row, thresholds) => (tpslWarning(row, thresholds) ? 100 : null),
    message: (row, _tierPct, thresholds) =>
      !row._hasTakeProfit && !row._hasStopLoss
        ? 'No Take Profit or Stop Loss set on any open position.'
        : `Daily Drawdown has crossed ${thresholds.dailyDrawdownPct}% of Max Daily Drawdown and this account still has no Stop Loss set.`,
  },
];

// Never throws -- every failure mode (missing config, API error, network
// error) is caught and reported in the returned { ok, error } instead, so
// callers on the hot /write path can fire-and-forget it safely, while
// /notify/test can still surface exactly what went wrong.
async function sendPushover(title, message, { priority = 0, sound } = {}) {
  // Unlike notify-config.json (re-read fresh on every check), .env is only
  // loaded once at startup (see the top of this file) -- process.loadEnvFile
  // never overwrites a variable already present in process.env, so calling
  // it again here wouldn't pick up an edited PUSHOVER_API_TOKEN anyway.
  // Editing .env requires restarting the server (`node server.js`) to take
  // effect.
  const userKey = process.env.PUSHOVER_USER_KEY;
  const apiToken = process.env.PUSHOVER_API_TOKEN;
  if (!userKey || !apiToken) {
    const error = `Pushover not configured -- set PUSHOVER_USER_KEY + PUSHOVER_API_TOKEN in ${ENV_FILE}`;
    console.warn(`[notify] ${error} -- skipped: ${title}`);
    return { ok: false, error };
  }
  const body = new URLSearchParams({
    token: apiToken,
    user: userKey,
    title,
    message,
    priority: String(priority),
  });
  if (sound) body.set('sound', sound);
  try {
    const res = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body });
    if (!res.ok) {
      const error = await res.text();
      console.error('[notify] Pushover API error:', res.status, error);
      return { ok: false, error: `${res.status}: ${error}` };
    }
    console.log(`[${new Date().toISOString()}] notify: sent "${title}"`);
    return { ok: true };
  } catch (err) {
    console.error('[notify] Failed to reach Pushover:', err.message);
    return { ok: false, error: err.message };
  }
}

// One row per A-side account -- Balance/Equity/InitialBalance/etc. are
// account-level fields duplicated across every PositionLog row for that
// account, so the first row seen for each Platform+AccountID is enough (no
// need to aggregate across positions the way compute.js's leftGroups does
// for TotalSize/PositionPL, which aren't used by any warning check).
//
// StopLossPrice/TakeProfitPrice are the one exception -- those are
// PER-POSITION fields, not account-level ones, so the first-row-wins
// shortcut above would miss a Stop Loss set on an account's second open
// position. `_hasTakeProfit`/`_hasStopLoss` are aggregated across every row
// seen for that account (true if ANY open position has one set), same
// any-position-counts approach as compute.js's hasTakeProfit/hasStopLoss --
// underscore-prefixed since they're server-only additions, not real CSV
// columns.
//
// Accounts hidden via config.json's "hidden-accounts" (RuleEditForm's "Hide
// Account" button -- see setAccountHidden) are excluded here too, same as
// MainView excludes them (see trading-console's computeMainView). An
// account you've archived out of the dashboard shouldn't still buzz your
// phone.
function collectASideAccounts() {
  let hiddenKeys;
  try {
    const configJson = JSON.parse(fs.readFileSync(MATCH_RULES_CONFIG_FILE, 'utf8'));
    hiddenKeys = new Set(Array.isArray(configJson['hidden-accounts']) ? configJson['hidden-accounts'] : []);
  } catch {
    hiddenKeys = new Set();
  }

  const seen = new Map();
  for (const platformKey of PLATFORM_ORDER) {
    for (const row of platformRows[platformKey]) {
      if (!NOTIFY_A_SIDE_PLATFORMS.has(row.Platform)) continue;
      const key = `${row.Platform}|${row.AccountID}`;
      if (hiddenKeys.has(key)) continue;
      if (!seen.has(key)) seen.set(key, { ...row, _hasTakeProfit: false, _hasStopLoss: false });
      const acct = seen.get(key);
      if (row.TakeProfitPrice && row.TakeProfitPrice !== 'none') acct._hasTakeProfit = true;
      if (row.StopLossPrice && row.StopLossPrice !== 'none') acct._hasStopLoss = true;
    }
  }
  return [...seen.values()];
}

// notify-config.json's "tiers": { "<metricKey>": [80, 90, 95, 100] }
// overrides a metric's single `thresholds[thresholdKey]` value with a
// multi-rung ladder. Always returned sorted ascending regardless of the
// order written in the config file.
function tierLadderFor(metric, thresholds, cfg) {
  const override = cfg.tiers?.[metric.key];
  if (Array.isArray(override) && override.length) {
    const cleaned = override.map(Number).filter((n) => Number.isFinite(n));
    if (cleaned.length) return cleaned.sort((a, b) => a - b);
  }
  return [thresholds[metric.thresholdKey]];
}

// Index of the highest rung `value` has reached in `ladder` (ascending),
// or -1 if value is null or hasn't reached even the first (lowest) rung.
function tierIndexFor(value, ladder) {
  if (value === null) return -1;
  let idx = -1;
  for (let i = 0; i < ladder.length; i++) {
    if (value >= ladder[i]) idx = i;
    else break;
  }
  return idx;
}

// stateKey -> highest tier-ladder index already notified for that
// account+metric (-1 = none yet, i.e. below the first rung).
const tierState = new Map();

function checkWarningsAndNotify() {
  const cfg = loadNotifyConfig();
  const thresholds = { ...DEFAULT_NOTIFY_THRESHOLDS, ...cfg.thresholds };
  const metrics = WARNING_METRICS.filter((m) => cfg.metrics?.[m.key] !== false);

  for (const row of collectASideAccounts()) {
    for (const metric of metrics) {
      const ladder = tierLadderFor(metric, thresholds, cfg);
      // `thresholds` is passed through to value()/message() too -- only the
      // tpsl metric actually uses it (its warning depends on
      // dailyDrawdownPct, not just its own thresholdKey); every other
      // metric's value()/message() ignores the extra argument.
      const currentIndex = tierIndexFor(metric.value(row, thresholds), ladder);
      const stateKey = `${row.Platform}|${row.AccountID}|${metric.key}`;
      const lastIndex = tierState.has(stateKey) ? tierState.get(stateKey) : -1;
      // Only fires on a genuine climb to a new rung -- dropping back down
      // (currentIndex < lastIndex) just lowers the stored index so a later
      // re-climb through that same rung notifies again, same re-arm
      // behavior the old true/false version had at its one threshold.
      if (currentIndex > lastIndex) {
        const crossedTierPct = ladder[currentIndex];
        sendPushover(
          `${row.Platform} ${row.AccountID} -- ${metric.label}`,
          metric.message(row, crossedTierPct, thresholds),
          { priority: metric.priority, sound: metric.sound }
        );
      }
      tierState.set(stateKey, currentIndex);
    }
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function fileStatus(file) {
  try {
    return { lastWriteTime: fs.statSync(file).mtime.toISOString(), file };
  } catch {
    return { lastWriteTime: null, file };
  }
}

loadExistingPositions();

const server = http.createServer((req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    const status = { ok: true, positions: fileStatus(POSITIONS_FILE) };
    for (const platformKey of PLATFORM_ORDER) {
      status[platformKey] = { rows: platformRows[platformKey].length };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // Sends one real Pushover notification, independent of any actual
  // warning state -- lets you confirm notify-config.json is wired up
  // correctly without waiting for a real threshold breach.
  if (req.method === 'GET' && req.url === '/notify/test') {
    sendPushover('Trading Positions Tracker', 'Test notification -- if you got this, Pushover is wired up correctly.', {
      priority: 0,
    }).then((result) => {
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/write') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const config = PLATFORM_CONFIG[payload.platform];
        if (!config) throw new Error(`Unknown platform: ${payload.platform}`);

        platformRows[payload.platform] = config.build(payload);
        writeCombined();
        // Never let a bug in warning/notification logic take down position
        // writes -- this is a nice-to-have layered on top of the real job.
        try {
          checkWarningsAndNotify();
        } catch (err) {
          console.error('[notify] Warning check failed:', err);
        }
        const count = config.countRows(payload);
        console.log(`[${new Date().toISOString()}] ${payload.platform}: wrote ${count} row(s)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count }));
      } catch (err) {
        console.error('Failed to handle write:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/config/rule') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!payload.aPlatform || !payload.aAccountId) throw new Error('aPlatform and aAccountId are required');
        applyRuleEdit(payload);
        console.log(`[${new Date().toISOString()}] config: updated rule for ${payload.aPlatform}|${payload.aAccountId}${payload.aSymbol ? `|${payload.aSymbol}` : ''}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Failed to update config:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  // RuleEditForm's "Delete" button -- removes the matched rule entirely
  // instead of replacing it. Body shape is the identifying subset of
  // /config/rule's payload: { aPlatform, aAccountId, aSymbol }.
  if (req.method === 'DELETE' && req.url === '/config/rule') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!payload.aPlatform || !payload.aAccountId) throw new Error('aPlatform and aAccountId are required');
        deleteRule(payload);
        console.log(`[${new Date().toISOString()}] config: deleted rule for ${payload.aPlatform}|${payload.aAccountId}${payload.aSymbol ? `|${payload.aSymbol}` : ''}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Failed to delete rule:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  // RuleEditForm's "Hide Account" button and SettingsPage's "Unhide"
  // button both post here -- `hidden: true` adds the account to
  // config.json's "hidden-accounts" array, `hidden: false` removes it.
  if (req.method === 'POST' && req.url === '/config/account-visibility') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!payload.aPlatform || !payload.aAccountId) throw new Error('aPlatform and aAccountId are required');
        setAccountHidden(payload);
        console.log(`[${new Date().toISOString()}] config: ${payload.hidden ? 'hid' : 'unhid'} account ${payload.aPlatform}|${payload.aAccountId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Failed to update account visibility:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Trading Positions Tracker server listening on http://127.0.0.1:${PORT}`);
  console.log(`  positions -> ${POSITIONS_FILE}`);
});
