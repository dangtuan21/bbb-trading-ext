// Runs on trader.ftmo.oanda.com. Reads Balance/Equity/Open trades from
// whatever account's MetriX page is currently open, on a fixed interval --
// same "watch whatever tab is open" model as tastyfx, since (unlike
// RebelsFunding) this is a single account/single origin with no SSO
// redirect. Ported from bbb-trading/trading-back/platforms/ftmo.py, a
// Playwright scraper already confirmed working against this exact site
// (including a real open position end-to-end).

const DEFAULT_CAPTURE_INTERVAL_MINUTES = 20;
// Hardcoded per the Python reference: not confirmed scrapeable, and only
// changes if this account progresses to Verification/Funded.
const DEFAULT_ACCOUNT_LABEL = 'FTMO Challenge';
const DEFAULT_IS_REAL_MONEY = 'No';

const LABEL_VARIANTS = {
  balance: ['Balance', 'Account Balance', 'Starting Balance'],
  equity: ['Equity', 'Current Equity', 'Account Equity'],
  pl: ['Unrealized PnL', 'Unrealized P/L', 'P&L', 'P/L', 'Profit', 'Total P&L', 'Account P&L'],
  // Same CSV columns RebelsFunding's Contest stats tab already feeds
  // (MaxDailyDrawdown/TodayDrawdown -- "Max Daily DD"/"Cur Daily DD" in
  // MainView) -- FTMO's own "Today's permitted loss"/"Today's profit"
  // cards are this account's equivalent figures. Both apostrophe forms
  // covered defensively, same as this file's other multi-variant labels.
  maxDailyDrawdown: ["Today's permitted loss", "Today’s permitted loss", 'Todays permitted loss'],
  todayDrawdown: ["Today's profit", "Today’s profit", 'Todays profit'],
};

const ORDER_ID_RE = /^\d{5,}$/;
// Symbols render like "AUDUSD.sim" (no "/", optional suffix).
const SYMBOL_RE = /^([A-Z]{6,8})(\.[A-Za-z]+)?$/;
const MONEY_RE = /^-?\$[\d,]+\.\d{2}$/;
const BARE_NUMBER_RE = /^-?\d+(\.\d+)?$/;

function money(s) {
  return (s || '').replace('$', '').replace(/,/g, '').trim();
}

function valueAfterAny(lines, labels) {
  for (const label of labels) {
    const idx = lines.indexOf(label);
    if (idx >= 0 && idx + 1 < lines.length) return lines[idx + 1];
  }
  return '';
}

// "Max Loss: -$1,000" (an Objectives-table link) -- unlike Balance/Equity/
// etc., the value is embedded directly in the label text itself, not on a
// following line. Maps to the same MaxDrawdownAmount column ("Max DD" in
// MainView) RebelsFunding's own overall Max Drawdown already feeds --
// stored as a positive magnitude for consistency with that convention
// (this label's own text is written negative, e.g. "-$1,000").
function parseMaxLoss(lines) {
  for (const line of lines) {
    if (line.startsWith('Max Loss:')) {
      const m = /-?\$?\s*([\d,]+(?:\.\d+)?)/.exec(line.slice('Max Loss:'.length));
      if (m) return m[1].replace(/,/g, '');
    }
  }
  return '';
}

// "AUDUSD.sim" -> "AUD/USD". Already-slashed or unrecognized formats pass
// through unchanged (uppercased).
function normalizeSymbol(raw) {
  const s = raw.trim().toUpperCase();
  if (s.includes('/')) return s;
  const base = s.split('.')[0];
  if (base.length === 6 && /^[A-Z]+$/.test(base)) {
    return `${base.slice(0, 3)}/${base.slice(3)}`;
  }
  return s;
}

// Open trades' Volume and Symbol cells render as ONE line joined by a tab
// character (e.g. "0.75\tAUDUSD.sim"), not two separate lines like every
// other cell -- split on tabs too so each cell is its own entry.
function getPageLines() {
  const text = document.body.innerText || '';
  return text.replace(/\t/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
}

function parseAccountSummary(lines) {
  const balance = money(valueAfterAny(lines, LABEL_VARIANTS.balance));
  const equity = money(valueAfterAny(lines, LABEL_VARIANTS.equity));
  // Read directly from whichever P/L label is actually on the page (see
  // LABEL_VARIANTS.pl) -- no Equity-Balance fallback if none of those
  // labels are found; left blank rather than derived.
  const accountPL = money(valueAfterAny(lines, LABEL_VARIANTS.pl));
  const maxDailyDrawdown = money(valueAfterAny(lines, LABEL_VARIANTS.maxDailyDrawdown));
  const todayDrawdown = money(valueAfterAny(lines, LABEL_VARIANTS.todayDrawdown));
  const maxDrawdownAmount = parseMaxLoss(lines);
  return { balance, equity, accountPL, maxDailyDrawdown, todayDrawdown, maxDrawdownAmount };
}

// Anchors on each Symbol match and searches a small window of nearby lines
// for the other columns: an order ID before it, a Buy/Sell direction before
// it, a bare number (Volume) right before it, a money value (PnL) after it.
function parseOpenTrades(lines) {
  const positions = [];
  const seenOrderIds = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!SYMBOL_RE.test(line)) continue;
    const symbol = normalizeSymbol(line);

    const before = lines.slice(Math.max(0, i - 6), i);
    const after = lines.slice(i + 1, i + 6);

    let direction = '';
    for (let j = before.length - 1; j >= 0; j--) {
      if (before[j] === 'Buy' || before[j] === 'Sell') {
        direction = before[j];
        break;
      }
    }
    if (!direction) continue; // not enough signal this is really a trade row

    let orderId = '';
    for (let j = before.length - 1; j >= 0; j--) {
      if (ORDER_ID_RE.test(before[j])) {
        orderId = before[j];
        break;
      }
    }
    if (!orderId || seenOrderIds.has(orderId)) continue;

    let volume = '';
    for (let j = before.length - 1; j >= 0; j--) {
      if (BARE_NUMBER_RE.test(before[j]) && !ORDER_ID_RE.test(before[j])) {
        volume = before[j];
        break;
      }
    }

    let pnl = '';
    for (const l of after) {
      if (MONEY_RE.test(l)) {
        pnl = money(l);
        break;
      }
    }

    seenOrderIds.add(orderId);
    positions.push({
      PosID: `#${orderId}`,
      Symbol: symbol,
      Direction: direction,
      Size: volume,
      SizeUnit: 'lot',
      Opening: 'n/a',
      Latest: 'n/a',
      StopLoss: 'none',
      TakeProfit: 'none',
      PositionPL: pnl,
    });
  }
  return positions;
}

function scrollMarkerIntoView(marker) {
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    if (el.children.length === 0 && el.textContent.trim() === marker) {
      el.scrollIntoView({ block: 'center' });
      return true;
    }
  }
  return false;
}

function accountIdFromUrl() {
  const m = /\/metrix\/(\d+)/.exec(location.pathname);
  return m ? m[1] : null;
}

function fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getFullYear()}`;
}

function buildRows(summary, positions) {
  const base = {
    SnapshotDate: fmtDate(new Date()),
    Platform: 'FTMO',
    AccountID: accountIdFromUrl() || 'n/a',
    AccountLabel: DEFAULT_ACCOUNT_LABEL,
    IsRealMoney: DEFAULT_IS_REAL_MONEY,
    Balance: summary.balance,
    Equity: summary.equity,
    AccountPL: summary.accountPL,
    MaxDailyDrawdown: summary.maxDailyDrawdown,
    TodayDrawdown: summary.todayDrawdown,
    MaxDrawdownAmount: summary.maxDrawdownAmount,
  };

  if (!positions.length) {
    return [{
      ...base, PosID: 'n/a', Symbol: 'n/a', Direction: 'n/a', Size: 'n/a', SizeUnit: 'n/a',
      Opening: 'n/a', Latest: 'n/a', StopLoss: 'none', TakeProfit: 'none', PositionPL: summary.accountPL,
    }];
  }
  return positions.map((p) => ({ ...base, ...p }));
}

// Balance/Open-trades content is lazy-rendered based on scroll position --
// if either came back empty on the first pass, scroll the relevant heading
// into view and retry once before giving up.
async function captureFtmoRows() {
  let lines = getPageLines();
  let summary = parseAccountSummary(lines);
  let positions = parseOpenTrades(lines);
  let scrolled = false;

  if (!summary.balance || positions.length === 0) {
    scrolled = scrollMarkerIntoView('Current Results') || scrollMarkerIntoView('Open trades');
    if (scrolled) {
      await new Promise((r) => setTimeout(r, 1200));
      lines = getPageLines();
      summary = parseAccountSummary(lines);
      positions = parseOpenTrades(lines);
    }
  }

  const balanceDiag = !summary.balance
    ? { reason: 'balance-not-found', scrolled, hasBalanceText: document.body.innerText.includes('Balance'), hasOpenTradesText: document.body.innerText.includes('Open trades'), url: location.href }
    : null;

  // Debug aid: "Today's permitted loss"/"Today's profit"/"Max Loss:" are
  // unconfirmed guesses at the real label text (from screenshots, not a
  // live DOM check) -- if any doesn't match, surface every line that
  // plausibly relates (the regex already covers "Max Loss:" too, via
  // "loss") so the real label can be read off directly instead of guessed
  // again blind, same approach that nailed down RebelsFunding's real
  // "Today's Drawdown" label.
  const drawdownDiag = !summary.maxDailyDrawdown || !summary.todayDrawdown || !summary.maxDrawdownAmount
    ? { reason: 'drawdown-labels-not-found', nearbyLines: lines.filter((l) => /permitted|profit|loss/i.test(l)) }
    : null;

  return { rows: buildRows(summary, positions), diag: balanceDiag || drawdownDiag };
}

async function captureAndSend() {
  const { rows, diag } = await captureFtmoRows();
  chrome.runtime.sendMessage({ type: 'FTMO_ROWS', rows, diag }).catch((err) => {
    console.debug('[FTMO Tracker] Failed to send rows:', err);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FORCE_CAPTURE') {
    captureAndSend();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

let captureTimerId = null;
function startCaptureTimer(minutes) {
  if (captureTimerId) clearInterval(captureTimerId);
  const ms = Math.max(1, minutes || DEFAULT_CAPTURE_INTERVAL_MINUTES) * 60 * 1000;
  captureTimerId = setInterval(captureAndSend, ms);
}

chrome.storage.local.get('captureIntervalMinutes', ({ captureIntervalMinutes }) => {
  startCaptureTimer(captureIntervalMinutes || DEFAULT_CAPTURE_INTERVAL_MINUTES);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captureIntervalMinutes) {
    startCaptureTimer(changes.captureIntervalMinutes.newValue);
  }
});

setTimeout(captureAndSend, 3000);
