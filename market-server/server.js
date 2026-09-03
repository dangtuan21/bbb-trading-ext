// Fetches FX rates from TwelveData ON DEMAND -- POST /fetch -- rather than
// polling on a fixed interval (deliberately removed; a caller decides when a
// fetch is worth the TwelveData credits, trading-console's Market View "Refresh"
// button being the first one). Each fetch writes two files:
//
//  - market.csv: the latest rate for every pair the fetch needed (upserted
//    in full each time -- one row per pair, "current known rate", not an
//    ever-growing history, same convention ext-server/positions.csv already
//    uses for its own "latest known state per key" rows).
//  - market-positions.csv: the "Market View" reconstruction. Deliberately
//    written in EXACTLY positions.csv's own format (same HEADER, same
//    one-row-per-position-or-per-empty-account shape, every platform) --
//    not a narrower analytics file -- so trading-console's Market View tab
//    can run it through the exact same computeMainView() the real MainView
//    tab already uses, instead of needing its own parallel join/matching
//    logic. Every RebelsFunding/FTMO/tastyfx OPEN position (AlphaCapital
//    skipped for now -- see IN_SCOPE_PLATFORMS) gets its Latest/PositionPL
//    re-estimated from this fetch's live rate, and each of those accounts'
//    Equity gets recomputed as Balance + the sum of its own positions'
//    (estimated-where-possible) PositionPL. Every other row -- AlphaCapital
//    entirely, an in-scope account's own "nothing open" placeholder row, a
//    position whose rate/prior movement can't support an estimate -- is
//    copied through completely unchanged. See computeMarketPositions for
//    the estimation math and why it needs no lot-size/pip-value/currency-
//    conversion table at all.
//
// The pair list each fetch requests is config.json's "pairs" UNION every
// symbol currently open across those three platforms' positions.csv rows --
// not just config.json alone -- so a newly-opened position in a pair nobody
// thought to add to config.json still gets a live estimate on the very next
// fetch instead of silently falling back to "n/a" or a stale scrape.
//
// POST /fetch runs one fetch cycle synchronously (see runFetchCycle) and
// responds with the same data it just wrote to disk -- rates, the full
// market-positions rows, and fresh/stale/missing counts -- so a caller
// doesn't need a second round-trip to read the CSVs back. It can take over
// a minute to respond once TwelveData's chunking kicks in (more than 8
// pairs needed -- see CREDITS_PER_MINUTE_LIMIT/CHUNK_STAGGER_MS below), so
// callers should show a loading state rather than expect an instant reply.
// CORS is wide open (Access-Control-Allow-Origin: *) the same way
// ext-server's HTTP server already is, since this is only ever reachable
// from localhost.
//
// config.json's pair list is re-read on every fetch (like ext-server's
// notify-config.json), so adding/removing a pair there takes effect on the
// very next POST /fetch with no restart needed.

const fs = require('fs');
const path = require('path');
const http = require('http');

const ENV_FILE = path.join(__dirname, '.env');
try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // No .env yet -- reported clearly in main() once TWELVEDATA_API_KEY is read.
}

// Distinct from ext-server's 8765 and trading-console's dev-server 5173.
const PORT = 8766;

const CONFIG_FILE = path.join(__dirname, 'config.json');
const MARKET_FILE = path.join(__dirname, 'market.csv');
const FRONTEND_DATA_DIR = path.join(__dirname, '..', 'trading-console', 'public', 'data');
const MARKET_MIRROR_FILE = path.join(FRONTEND_DATA_DIR, 'market.csv');
const TWELVEDATA_URL = 'https://api.twelvedata.com/price';

const MARKET_HEADER = ['Symbol', 'Rate', 'FetchedAt'];

// positions.csv's own source file (ext-server writes both this and its
// trading-console mirror together in one write -- see ext-server/server.js's
// writeCombined -- so reading either is equally current; this reads the
// source rather than the mirror on general principle).
const POSITIONS_FILE = path.join(__dirname, '..', 'ext-server', 'positions.csv');
const MARKET_POSITIONS_FILE = path.join(__dirname, 'market-positions.csv');
const MARKET_POSITIONS_MIRROR_FILE = path.join(FRONTEND_DATA_DIR, 'market-positions.csv');

// Matches the Market View scope agreed on when this was designed:
// AlphaCapital skipped for now (see server.js's top comment) because it has
// the shakiest account-level baseline (no scraped AccountPL at all) and the
// loosest symbol regex of the four extensions.
const IN_SCOPE_PLATFORMS = new Set(['RebelsFunding', 'FTMO', 'tastyfx']);

// The exact same column list as ext-server/server.js's own HEADER --
// duplicated rather than shared (these are two independent zero-dependency
// Node processes; same "keep both in sync by hand" tradeoff this file's
// parseCsvLine/csvField duplication already accepts below). Keep this in
// sync if positions.csv's schema ever changes -- market-positions.csv
// needs to stay format-identical for trading-console's computeMainView()
// reuse to keep working.
const MARKET_POSITIONS_HEADER = [
  'SnapshotDate', 'Platform', 'AccountID', 'AccountLabel', 'Phase', 'IsRealMoney',
  'Balance', 'Equity', 'AccountPL',
  'InitialBalance', 'StartingEquity', 'MaxDailyDrawdown', 'MaxDailyDrawdownPct',
  'TodayDrawdown', 'TodayDrawdownPct',
  'MaxDrawdownAmount', 'MaxDrawdownPct', 'CurrentValueAmount', 'CurrentValuePct',
  'ProfitTarget',
  'PosID', 'Symbol', 'Direction', 'Size', 'SizeUnit',
  'Opening', 'Latest', 'StopLossPrice', 'TakeProfitPrice', 'PositionPL',
];

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  const config = JSON.parse(raw);
  if (!Array.isArray(config.pairs) || config.pairs.length === 0) {
    throw new Error(`${CONFIG_FILE} must have a non-empty "pairs" array`);
  }
  return {
    pairs: config.pairs,
  };
}

// Minimal CSV parsing -- copied from ext-server/server.js's parseCsvLine
// rather than shared, same "keep both in sync by hand" tradeoff that file's
// own ratioPct duplication (from trading-console's compute.js) already
// accepts: these are two independent zero-dependency Node processes, not
// worth a shared package for one small function. Handles quoted fields and
// escaped quotes; no embedded newlines inside a field, matching what
// ext-server's own csvField ever produces.
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

function csvField(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Reads positions.csv and returns EVERY row (every platform, open or not),
// as plain { [header]: value } objects -- computeMarketPositions below
// decides which ones qualify for a live estimate; this just loads the raw
// material. Returns [] (not a throw) if positions.csv doesn't exist yet --
// e.g. a fresh checkout before ext-server has ever received a real scrape --
// since "nothing to build market-positions.csv from yet" is a normal
// startup state, not an error condition worth aborting the cycle over.
function loadPositions() {
  let text;
  try {
    text = fs.readFileSync(POSITIONS_FILE, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((key, idx) => { row[key] = fields[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// A row counts as an "open in-scope position" -- eligible for a live
// Latest/PositionPL estimate -- when it's RebelsFunding/FTMO/tastyfx AND
// has a real Symbol, not the "nothing open right now" placeholder row
// every platform writes for an account with no open position (Symbol
// "n/a" -- see ext-server's PLATFORM_CONFIG build functions).
function isOpenInScopePosition(row) {
  return IN_SCOPE_PLATFORMS.has(row.Platform) && !!row.Symbol && row.Symbol !== 'n/a';
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Re-estimates ONE open position's Latest/PositionPL from a live rate,
// without needing to know its lot size, pip value, or quote currency at
// all. Same trick trading-console's compute.js already uses for
// stopLossRiskAmount: derive an implied $-per-price-unit rate from the
// position's own last-known real numbers --
// PositionPL / (Latest - Opening) -- which already bakes in whatever the
// platform actually pays per unit of price movement for this exact
// position (contract size, leverage, quote-currency conversion, all of
// it), then apply that same rate to the distance from Opening to the new
// live price. Validated against real RebelsFunding rows before this was
// built (USD/CAD and EUR/AUD reconstructions landed within ~0.2% of the
// platform's own scraped PositionPL).
//
// Returns { latest, positionPL, estimated: true } on success. Returns
// { latest: row.Latest, positionPL: row.PositionPL, estimated: false } --
// i.e. carries the last real scrape forward unchanged -- when it can't be
// computed: no live rate for this row's Symbol this cycle, or
// Opening/Latest/PositionPL aren't all present and numeric, or
// Latest === Opening (position hasn't moved since it opened, so the
// $-per-price-unit rate is an undefined 0/0 -- same edge case
// stopLossRiskAmount hits, and it resolves itself once price has moved at
// all by the next real scrape or the next live tick).
function estimatePosition(row, rates) {
  const carryForward = { latest: row.Latest, positionPL: row.PositionPL, estimated: false };

  const liveRate = rates[row.Symbol];
  if (liveRate == null) return carryForward;

  const opening = toNumber(row.Opening);
  const lastLatest = toNumber(row.Latest);
  const lastPL = toNumber(row.PositionPL);
  if (opening === null || lastLatest === null || lastPL === null) return carryForward;

  const priceMove = lastLatest - opening;
  if (priceMove === 0) return carryForward;

  const dollarPerPriceUnit = lastPL / priceMove;
  const positionPL = round2(dollarPerPriceUnit * (liveRate - opening));
  return { latest: liveRate, positionPL, estimated: true };
}

// Builds every market-positions.csv row -- same length and shape as
// `allRows` (every row from positions.csv, every platform), with:
//  - each open in-scope (RebelsFunding/FTMO/tastyfx) position's
//    Latest/PositionPL replaced by estimatePosition's result
//  - each of THOSE accounts' Equity replaced by Balance + the sum of its
//    own positions' PositionPL (estimated where possible, last-known
//    otherwise -- "best estimate from whatever we have", same
//    partial-data philosophy estimatePosition itself already applies)
//  - each of THOSE accounts' AccountPL replaced by (recomputed Equity -
//    Balance) -- confirmed against real scraped data that this is exactly
//    how every in-scope platform's own AccountPL relates to its Equity
//    (e.g. a real RebelsFunding row: 42368.66 Equity - 39995.33 Balance =
//    2373.33 AccountPL, to the cent), so once Equity is being estimated
//    live, AccountPL needs to move with it or it silently goes stale --
//    same for A_TargetProfitWarning in trading-console's compute.js, which
//    reads AccountPL, not Equity, to decide whether the profit target's
//    been hit.
//  - every other field on every row, and every row that isn't an open
//    in-scope position at all (AlphaCapital, an in-scope account's own
//    "nothing open" placeholder row), copied through byte-for-byte
// `estimates` is keyed by row OBJECT IDENTITY (these are the exact same
// row objects from `allRows`, never cloned before this point) rather than
// a string key like Platform+AccountID+Symbol -- several of your real RF
// accounts hold two open tickets in the same symbol at once (EUR/NZD,
// NZD/CHF), so a string key would collide; object identity can't.
// Returns { rows, freshCount, staleCount, missingSymbols } -- the counts
// and missing-symbol list are for the log line pollOnce prints, not
// written into the CSV itself.
function computeMarketPositions(allRows, rates) {
  const estimates = new Map();
  for (const row of allRows) {
    if (isOpenInScopePosition(row)) estimates.set(row, estimatePosition(row, rates));
  }

  const equityByAccount = new Map();
  const balanceByAccount = new Map();
  for (const [row, estimate] of estimates) {
    const key = `${row.Platform}|${row.AccountID}`;
    const balance = toNumber(row.Balance) ?? 0;
    if (!equityByAccount.has(key)) {
      equityByAccount.set(key, balance);
      balanceByAccount.set(key, balance);
    }
    const pl = toNumber(estimate.positionPL);
    if (pl !== null) equityByAccount.set(key, equityByAccount.get(key) + pl);
  }

  const missingSymbols = new Set();
  const rows = allRows.map((row) => {
    const estimate = estimates.get(row);
    if (estimate && !estimate.estimated && rates[row.Symbol] == null) missingSymbols.add(row.Symbol);
    const accountKey = `${row.Platform}|${row.AccountID}`;
    const hasAccountEstimate = equityByAccount.has(accountKey);
    const equity = hasAccountEstimate ? round2(equityByAccount.get(accountKey)) : null;
    return {
      ...row,
      Latest: estimate ? estimate.latest : row.Latest,
      PositionPL: estimate ? estimate.positionPL : row.PositionPL,
      Equity: hasAccountEstimate ? equity : row.Equity,
      AccountPL: hasAccountEstimate ? round2(equity - balanceByAccount.get(accountKey)) : row.AccountPL,
    };
  });

  const allEstimates = [...estimates.values()];
  return {
    rows,
    freshCount: allEstimates.filter((e) => e.estimated).length,
    staleCount: allEstimates.filter((e) => !e.estimated).length,
    missingSymbols: [...missingSymbols],
  };
}

function writeMarketPositionsCsv(rows) {
  const lines = [MARKET_POSITIONS_HEADER.join(',')];
  for (const row of rows) {
    lines.push(MARKET_POSITIONS_HEADER.map((key) => csvField(row[key])).join(','));
  }
  const csv = lines.join('\n') + '\n';

  fs.writeFileSync(MARKET_POSITIONS_FILE, csv);
  try {
    fs.mkdirSync(FRONTEND_DATA_DIR, { recursive: true });
    fs.writeFileSync(MARKET_POSITIONS_MIRROR_FILE, csv);
  } catch (err) {
    console.warn(`[market-server] Could not mirror market-positions.csv into trading-console: ${err.message}`);
  }
}

async function fetchRates(pairs, apiKey) {
  const url = `${TWELVEDATA_URL}?symbol=${encodeURIComponent(pairs.join(','))}&apikey=${apiKey}`;
  const res = await fetch(url);
  const body = await res.json();
  return parseRatesResponse(body, pairs);
}

// TwelveData's free tier caps at 8 API credits per minute, and -- confirmed
// against a real response on 2026-09-01 -- it charges 1 credit per symbol
// even within a single batched request: asking for all 9 configured pairs
// in one call got "TwelveData error 429: ... 9 API credits were used, with
// the current limit being 8", not a successful batch. So each poll cycle's
// pairs are split into chunks of at most CREDITS_PER_MINUTE_LIMIT, and
// chunks after the first are sent CHUNK_STAGGER_MS apart -- long enough to
// land in a fresh TwelveData per-minute window -- instead of one request
// that will always be rejected once there are more than 8 pairs configured.
const CREDITS_PER_MINUTE_LIMIT = 8;
const CHUNK_STAGGER_MS = 65 * 1000; // a little over a minute, so each chunk lands in a new rate-limit window

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetches all configured pairs across one or more chunked requests, staying
// under CREDITS_PER_MINUTE_LIMIT per request. A chunk that fails (rate
// limit, transient network error, etc.) is logged and skipped rather than
// aborting the whole cycle -- whatever chunks DID succeed still get written
// to market.csv, same "partial data beats no data" philosophy
// parseRatesResponse already applies to individual missing pairs.
// `sleep` is injectable so tests don't have to wait CHUNK_STAGGER_MS for
// real.
async function fetchRatesChunked(pairs, apiKey, sleep = defaultSleep) {
  const chunks = chunk(pairs, CREDITS_PER_MINUTE_LIMIT);
  const rates = {};
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(CHUNK_STAGGER_MS);
    try {
      Object.assign(rates, await fetchRates(chunks[i], apiKey));
    } catch (err) {
      console.warn(
        `[market-server] Chunk ${i + 1}/${chunks.length} (${chunks[i].join(', ')}) failed -- ${err.message}`
      );
    }
  }
  return rates;
}

// TwelveData's own documentation disagrees with itself on whether /price's
// comma-separated multi-symbol form is actually supported, and if so
// whether the result comes back as one dict keyed by symbol (each value
// either {price: "..."} or a bare price string) -- this wasn't something
// that could be confirmed without a real API key, so rather than guess one
// shape and risk silently mis-parsing a real response into wrong numbers,
// this handles every shape it plausibly could be:
//  - a single configured pair always gets TwelveData's documented flat
//    {price: "..."} shape
//  - multiple configured pairs are tried as one batched request; if that
//    comes back keyed by symbol, each pair's rate is pulled out by key,
//    whether nested under .price or given bare
//  - an explicit {status: "error", code, message} response (bad key, rate
//    limit, etc.) throws rather than being silently treated as a 0 rate --
//    a wrong-shaped 0 would corrupt every P&L estimate built on top of
//    market.csv far worse than this cycle's poll just failing and retrying
//    next interval
// Logs the raw response whenever a pair's rate can't be found, so the very
// first real run makes it obvious whether the batching assumption held.
function parseRatesResponse(body, pairs) {
  if (body && body.status === 'error') {
    throw new Error(`TwelveData error ${body.code}: ${body.message}`);
  }

  const rates = {};

  if (pairs.length === 1) {
    const price = body && body.price;
    if (price == null) {
      throw new Error(`Unexpected /price response shape for a single pair: ${JSON.stringify(body)}`);
    }
    rates[pairs[0]] = Number(price);
    return rates;
  }

  for (const pair of pairs) {
    const entry = body ? body[pair] : undefined;
    const price = entry && typeof entry === 'object' ? entry.price : entry;
    if (price == null) {
      console.warn(`[market-server] No rate found for ${pair} in the response -- raw response: ${JSON.stringify(body)}`);
      continue;
    }
    rates[pair] = Number(price);
  }
  return rates;
}

function writeMarketCsv(rates, fetchedAt) {
  const lines = [MARKET_HEADER.join(',')];
  for (const [symbol, rate] of Object.entries(rates)) {
    lines.push([symbol, rate, fetchedAt].join(','));
  }
  const csv = lines.join('\n') + '\n';

  fs.writeFileSync(MARKET_FILE, csv);
  try {
    fs.mkdirSync(FRONTEND_DATA_DIR, { recursive: true });
    fs.writeFileSync(MARKET_MIRROR_FILE, csv);
  } catch (err) {
    console.warn(`[market-server] Could not mirror market.csv into trading-console: ${err.message}`);
  }
}

// Runs one on-demand fetch: TwelveData for config.json's pairs UNION every
// open in-scope symbol, writes market.csv + market-positions.csv same as
// before, and returns a plain object describing what happened instead of
// just logging it -- the HTTP handler below turns this straight into the
// POST /fetch response body, so a caller gets the fresh data back without a
// second round-trip to read the CSVs. `ok: false` means neither file was
// touched (config unreadable, or TwelveData returned nothing usable) --
// existing market.csv/market-positions.csv are left as they were, stale but
// not wrong, same as the old polling loop's failure behavior.
async function runFetchCycle(apiKey) {
  const fetchedAt = new Date().toISOString();

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[market-server] ${fetchedAt}: could not read config.json -- ${err.message}.`);
    return { ok: false, fetchedAt, error: `could not read config.json -- ${err.message}` };
  }

  const allPositions = loadPositions();
  const inScopeOpenSymbols = allPositions.filter(isOpenInScopePosition).map((r) => r.Symbol);
  // config.json's pairs plus whatever's actually open right now -- see the
  // top-of-file comment for why this union matters (a newly-opened position
  // in a pair nobody added to config.json still needs a live rate).
  const neededPairs = [...new Set([...config.pairs, ...inScopeOpenSymbols])];

  let rates;
  try {
    rates = await fetchRatesChunked(neededPairs, apiKey);
  } catch (err) {
    console.error(`[market-server] ${fetchedAt}: fetch failed -- ${err.message}. market.csv/market-positions.csv left unchanged (stale, not wrong).`);
    return { ok: false, fetchedAt, error: `fetch failed -- ${err.message}` };
  }

  const gotCount = Object.keys(rates).length;
  if (gotCount === 0) {
    console.warn(`[market-server] ${fetchedAt}: got 0 usable rates back for ${neededPairs.length} pair(s) -- market.csv/market-positions.csv NOT updated.`);
    return { ok: false, fetchedAt, error: `got 0 usable rates back for ${neededPairs.length} pair(s)` };
  }

  writeMarketCsv(rates, fetchedAt);
  const missingRates = neededPairs.filter((p) => !(p in rates));
  console.log(
    `[market-server] ${fetchedAt}: wrote ${gotCount}/${neededPairs.length} rates to market.csv` +
      (missingRates.length ? ` (missing: ${missingRates.join(', ')})` : '')
  );

  let marketPositions = [];
  let freshCount = 0;
  let staleCount = 0;
  let missingSymbols = [];
  if (allPositions.length === 0) {
    console.log(`[market-server] ${fetchedAt}: positions.csv has no rows yet -- market-positions.csv not written.`);
  } else {
    const result = computeMarketPositions(allPositions, rates);
    marketPositions = result.rows;
    freshCount = result.freshCount;
    staleCount = result.staleCount;
    missingSymbols = result.missingSymbols;
    writeMarketPositionsCsv(marketPositions);
    console.log(
      `[market-server] ${fetchedAt}: wrote ${marketPositions.length} row(s) to market-positions.csv ` +
        `(${freshCount} freshly estimated, ${staleCount} carried forward, ${marketPositions.length - freshCount - staleCount} out of scope/unchanged)` +
        (missingSymbols.length ? ` -- no rate for: ${missingSymbols.join(', ')}` : '')
    );
  }

  return {
    ok: true,
    fetchedAt,
    rates,
    ratesRequested: neededPairs.length,
    ratesReceived: gotCount,
    missingRates,
    marketPositions,
    freshCount,
    staleCount,
    missingSymbols,
  };
}

// CORS headers on every response, same as ext-server's HTTP server -- this
// is only ever reachable from localhost, so a wide-open origin is fine.
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function startServer(apiKey) {
  const server = http.createServer((req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/fetch') {
      runFetchCycle(apiKey)
        .then((result) => {
          res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        })
        .catch((err) => {
          console.error(`[market-server] POST /fetch: unexpected error -- ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[market-server] Listening on http://127.0.0.1:${PORT} -- POST /fetch to trigger a fetch and get the result back.`);
  });
}

function main() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    console.error(`[market-server] TWELVEDATA_API_KEY not set -- copy .env.example to .env and fill it in (see ${ENV_FILE}).`);
    process.exit(1);
  }

  // Fails fast on a broken config.json at startup, same as before -- even
  // though each fetch re-reads it, there's no point starting the server on
  // a config that can't even load once.
  const { pairs } = loadConfig();
  console.log(`[market-server] Tracking ${pairs.length} pair(s) (${pairs.join(', ')}) by default -- editing config.json's "pairs" takes effect on the next POST /fetch.`);

  startServer(apiKey);
}

// Only runs main() (which calls process.exit(1) if TWELVEDATA_API_KEY isn't
// set) when this file is executed directly (`node server.js`), not when
// it's require()'d -- e.g. from a test harness that wants the pure
// functions below without booting the whole poller.
if (require.main === module) {
  main();
}

module.exports = {
  chunk,
  fetchRatesChunked,
  parseRatesResponse,
  parseCsvLine,
  loadPositions,
  isOpenInScopePosition,
  estimatePosition,
  computeMarketPositions,
  runFetchCycle,
  startServer,
};
