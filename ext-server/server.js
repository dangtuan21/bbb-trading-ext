// Zero-dependency local server shared by the TastyFX, RebelsFunding, FTMO,
// and AlphaCapital Positions Tracker extensions. One process, one port, one
// endpoint -- POST /write with a "platform" field routes to the right CSV
// builder/file. Binds to 127.0.0.1 only -- not reachable from the network.

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

const FRONTEND_DATA_DIR = path.join(__dirname, '..', 'trading-front', 'public', 'data');

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

const TASTYFX_HEADER = [
  'SnapshotDate', 'Platform', 'AccountID', 'AccountLabel',
  'Balance', 'Equity', 'AccountPL',
  'PosID', 'Symbol', 'Direction', 'Size', 'SizeUnit',
  'Opening', 'Latest', 'StopLoss', 'TakeProfit', 'PositionPL',
];

function buildTastyfxCsv({ snapshot, accountId, accountLabel }) {
  const snapshotDate = fmtDate(snapshot.timestamp);
  const balance = snapshot.account?.funds ?? null;
  const accountPL = snapshot.account?.profitloss ?? null;
  const equity = balance !== null && accountPL !== null ? balance + accountPL : null;

  const lines = [TASTYFX_HEADER.join(',')];
  for (const p of snapshot.positions || []) {
    const row = [
      snapshotDate, PLATFORM.TASTYFX, accountId, accountLabel,
      fmt2(balance), fmt2(equity), fmt2(accountPL),
      'n/a', p.market, p.size >= 0 ? 'Buy' : 'Sell', Math.abs(p.size), 'lot',
      p.opening, p.latest,
      p.stopLoss === null ? 'none' : p.stopLoss,
      p.takeProfit === null ? 'none' : p.takeProfit,
      fmt2(p.profitLossUsd),
    ];
    lines.push(row.map(csvField).join(','));
  }
  return lines.join('\n') + '\n';
}

// Shared by RebelsFunding, FTMO, and AlphaCapital -- all send an
// already-shaped array of rows (the extension does all scraping/shaping
// itself), unlike tastyfx which sends a raw snapshot this server transforms.
const ROWS_HEADER = [
  'SnapshotDate', 'Platform', 'AccountID', 'AccountLabel', 'IsRealMoney',
  'Balance', 'Equity', 'AccountPL',
  'PosID', 'Symbol', 'Direction', 'Size', 'SizeUnit',
  'Opening', 'Latest', 'StopLoss', 'TakeProfit', 'PositionPL',
];

function buildRowsCsv({ rows }) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  const lines = [ROWS_HEADER.join(',')];
  for (const row of rows) {
    lines.push(ROWS_HEADER.map((key) => csvField(row[key])).join(','));
  }
  return lines.join('\n') + '\n';
}

// One entry per platform: where its CSV lives, where it mirrors to for
// trading-front, how to build the CSV from the POSTed payload, and how to
// count rows for the log line / response.
const PLATFORM_CONFIG = {
  [PLATFORM.TASTYFX]: {
    file: path.join(__dirname, 'tastyfx-positions.csv'),
    mirrorFile: path.join(FRONTEND_DATA_DIR, 'tastyfx.csv'),
    build: buildTastyfxCsv,
    countRows: (payload) => payload.snapshot.positions?.length ?? 0,
  },
  [PLATFORM.REBELSFUNDING]: {
    file: path.join(__dirname, 'rebelsfunding-positions.csv'),
    mirrorFile: path.join(FRONTEND_DATA_DIR, 'rebelsfunding.csv'),
    build: buildRowsCsv,
    countRows: (payload) => payload.rows.length,
  },
  [PLATFORM.FTMO]: {
    file: path.join(__dirname, 'ftmo-positions.csv'),
    mirrorFile: path.join(FRONTEND_DATA_DIR, 'ftmo.csv'),
    build: buildRowsCsv,
    countRows: (payload) => payload.rows.length,
  },
  [PLATFORM.ALPHACAPITAL]: {
    file: path.join(__dirname, 'alphacapital-positions.csv'),
    mirrorFile: path.join(FRONTEND_DATA_DIR, 'alphacapital.csv'),
    build: buildRowsCsv,
    countRows: (payload) => payload.rows.length,
  },
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function mirrorToFrontend(file, csv) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, csv);
  } catch (err) {
    console.warn('Could not mirror to trading-front:', err.message);
  }
}

function fileStatus(file) {
  try {
    return { lastWriteTime: fs.statSync(file).mtime.toISOString(), file };
  } catch {
    return { lastWriteTime: null, file };
  }
}

const server = http.createServer((req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    const status = { ok: true };
    for (const [platform, config] of Object.entries(PLATFORM_CONFIG)) {
      status[platform] = fileStatus(config.file);
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

        const csv = config.build(payload);
        fs.writeFileSync(config.file, csv);
        mirrorToFrontend(config.mirrorFile, csv);
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

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Trading Positions Tracker server listening on http://127.0.0.1:${PORT}`);
  for (const [platform, config] of Object.entries(PLATFORM_CONFIG)) {
    console.log(`  ${platform} -> ${config.file}`);
  }
});
