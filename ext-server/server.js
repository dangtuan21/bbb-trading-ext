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
const FRONTEND_DATA_DIR = path.join(__dirname, '..', 'trading-front', 'public', 'data');
const POSITIONS_MIRROR_FILE = path.join(FRONTEND_DATA_DIR, 'positions.csv');

// Written directly (not mirrored) -- unlike positions.csv this IS the
// checked-in source file trading-front's matchRules.js imports at build
// time, so MainView's rule-editing UI (see App.jsx) intentionally leaves an
// edit trail in `git diff` instead of living in a gitignored runtime copy.
// Vite's own dev-server file watcher picks up the on-disk change and
// reloads the page -- no separate fetch/mirror path needed for the frontend
// to see it.
const MATCH_RULES_CONFIG_FILE = path.join(__dirname, '..', 'trading-front', 'src', 'data-fact', 'config.json');

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
// IsRealMoney -- its rows just leave that field blank.
const HEADER = [
  'SnapshotDate', 'Platform', 'AccountID', 'AccountLabel', 'IsRealMoney',
  'Balance', 'Equity', 'AccountPL',
  'PosID', 'Symbol', 'Direction', 'Size', 'SizeUnit',
  'Opening', 'Latest', 'StopLoss', 'TakeProfit', 'PositionPL',
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
    StopLoss: p.stopLoss === null ? 'none' : p.stopLoss,
    TakeProfit: p.takeProfit === null ? 'none' : p.takeProfit,
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
    console.warn('Could not mirror to trading-front:', err.message);
  }
}

// Finds the index of the position-rule entry matching a given A-side
// Platform+AccountID+symbol, where symbol === null means "the blanket rule
// for this account" (an "A-position" with no third segment) rather than
// "any rule for this account" -- a symbol-specific and a blanket rule can
// coexist for the same account, so this must distinguish them exactly the
// same way trading-front's matchRules.js parses "A-position".
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
  if (typeof payload.stopLoss === 'number' || typeof payload.takeProfit === 'number') {
    entry['Stoploss-Takeprofit'] = [
      typeof payload.stopLoss === 'number' ? payload.stopLoss : null,
      typeof payload.takeProfit === 'number' ? payload.takeProfit : null,
    ];
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

// JSON.stringify(_, null, 4) explodes every array (including
// Stoploss-Takeprofit's 2 numbers) onto its own lines, which would turn a
// one-rule edit into a diff touching every rule in the file -- the opposite
// of the point of writing straight to the checked-in file. Collapses just
// the short number-only arrays back onto one line after the fact; nothing
// else in this file's shape (strings, objects) needs the same treatment.
function formatConfigJson(obj) {
  const json = JSON.stringify(obj, null, 4);
  return json.replace(/\[\n\s*(-?\d+(?:\.\d+)?(?:,\n\s*-?\d+(?:\.\d+)?)*)\n\s*\]/g, (_match, nums) => {
    const compact = nums.split(',').map((n) => n.trim()).join(', ');
    return `[${compact}]`;
  }) + '\n';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
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

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Trading Positions Tracker server listening on http://127.0.0.1:${PORT}`);
  console.log(`  positions -> ${POSITIONS_FILE}`);
});
