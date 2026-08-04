// Runs on deal.ig.com. Scrapes the Positions table on a fixed interval and
// forwards each snapshot to the background service worker.

const DEFAULT_CAPTURE_INTERVAL_MINUTES = 20;

const NUMERIC_FIELDS = new Set([
  'SIZE', 'OPENING', 'LATEST', 'STOP LOSS', 'TAKE PROFIT', 'PROFIT/LOSS (USD)'
]);

function parseNumeric(raw) {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || /^add\s/i.test(trimmed)) return null; // "Add SL" / "Add TP" placeholders
  const cleaned = trimmed.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

// Finds the header row of the Positions table by looking for a row whose
// direct children contain the known column labels. Avoids relying on
// hashed/unstable class names.
function findHeaderRow() {
  const candidates = document.querySelectorAll('body *');
  for (const el of candidates) {
    if (el.children.length < 5) continue;
    const texts = Array.from(el.children).map((c) => c.textContent.trim().toUpperCase());
    if (texts.includes('MARKET') && texts.includes('SIZE') && texts.includes('LATEST')) {
      return el;
    }
  }
  return null;
}

const MARKET_PATTERN = /^[A-Z]{2,4}\/[A-Z]{2,4}$/;

// IG tags each cell with a semantic data-automation attribute (instrumentName,
// dealSize, openLevel, latest, stopLevel, ...) and a "cell-<field>" class as
// fallback. Keying off those is far more reliable than positional alignment,
// since the header row has extra non-data columns (checkbox/options) that
// don't exist in each data row, throwing off any index-based mapping.
function extractCellMap(row) {
  const map = {};
  for (const cell of row.children) {
    const automationKey = cell.getAttribute('data-automation');
    const classKey = Array.from(cell.classList).find((c) => c.startsWith('cell-'));
    const text = cell.textContent.trim();
    if (automationKey) map[automationKey] = text;
    if (classKey) map[classKey] = text;
  }
  return map;
}

function pickField(map, aliases) {
  for (const key of aliases) {
    if (key in map) return map[key];
  }
  return null;
}

const FIELD_ALIASES = {
  market: ['instrumentName', 'cell-market-name'],
  size: ['dealSize', 'cell-size'],
  opening: ['openLevel', 'cell-open-level'],
  latest: ['latest', 'cell-price-change'],
  stopLoss: ['stopLevel', 'cell-stop'],
  takeProfit: ['limitLevel', 'takeProfitLevel', 'cell-limit', 'cell-take-profit'],
  profitLossUsd: ['profitLossInBaseCurrency', 'cell-profit-loss-in-base-currency', 'profitLoss', 'pnl', 'positionPnl', 'cell-pl', 'cell-profit-loss']
};

function extractRows(headerRow) {
  const grid = headerRow.closest('.ig-grid') || headerRow.parentElement?.parentElement || headerRow.parentElement;
  if (!grid) return [];

  let rowEls = Array.from(grid.querySelectorAll('.ig-grid_row'));

  // Fallback: scan for any element directly containing a currency-pair-shaped
  // market cell, in case the "ig-grid_row" class isn't present.
  if (rowEls.length === 0) {
    rowEls = Array.from(grid.querySelectorAll('*')).filter((el) =>
      Array.from(el.children).some((c) => MARKET_PATTERN.test(c.textContent.trim()))
    );
  }

  const positions = [];
  for (const row of rowEls) {
    const map = extractCellMap(row);
    const market = pickField(map, FIELD_ALIASES.market);
    if (!market || !MARKET_PATTERN.test(market)) continue;

    positions.push({
      market,
      size: parseNumeric(pickField(map, FIELD_ALIASES.size)),
      opening: parseNumeric(pickField(map, FIELD_ALIASES.opening)),
      latest: parseNumeric(pickField(map, FIELD_ALIASES.latest)),
      stopLoss: parseNumeric(pickField(map, FIELD_ALIASES.stopLoss)),
      takeProfit: parseNumeric(pickField(map, FIELD_ALIASES.takeProfit)),
      profitLossUsd: parseNumeric(pickField(map, FIELD_ALIASES.profitLossUsd))
    });
  }
  return positions;
}

function scrapePositions() {
  const headerRow = findHeaderRow();
  if (!headerRow) return null;
  return extractRows(headerRow);
}

function isVisible(el) {
  return !!(el.offsetParent || el.getClientRects().length);
}

// Best-effort scrape of the account summary strip (Funds, Profit/Loss, Margin,
// Available, Cash Rebate). Looks for label/value pairs by known labels.
// IG's UI keeps hidden duplicate copies of this strip in the DOM (e.g. for
// other responsive breakpoints), which don't get reactively updated -- so
// this must skip hidden matches and take the first *visible* one, not just
// the last one found in document order.
function scrapeAccountSummary() {
  const labels = ['Funds', 'Profit/Loss', 'Margin', 'Available', 'Cash Rebate'];
  const summary = {};
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    const matchedLabel = labels.find((l) => text === l);
    if (!matchedLabel || !el.nextElementSibling) continue;

    const key = matchedLabel.toLowerCase().replace(/[^a-z]/g, '');
    if (key in summary) continue; // already have a visible match, don't overwrite
    if (!isVisible(el)) continue;

    summary[key] = parseNumeric(el.nextElementSibling.textContent);
  }
  return summary;
}

// Scrapes "Acc no.: DTEN3" and its label ("Standard") from the top-right
// account switcher. The label sits in a sibling element rather than the same
// leaf node as "Acc no.: ...", so this walks up a few ancestor levels and
// takes whatever text remains after stripping the "Acc no: ..." part out of
// the combined text -- robust to exact nesting depth, unlike guessing a
// specific sibling/parent relationship.
function scrapeAccountIdentity() {
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    if (el.children.length > 0 || !isVisible(el)) continue;
    const ownText = el.textContent.trim();
    const idMatch = /Acc\s*no\.?:?\s*([A-Za-z0-9]+)/i.exec(ownText);
    if (!idMatch) continue;

    const accountId = idMatch[1];
    let accountLabel = null;
    let container = el;
    for (let i = 0; i < 3 && container; i++) {
      const combined = container.textContent.replace(/\s+/g, ' ').trim();
      const withoutAccNo = combined.replace(/Acc\s*no\.?:?\s*[A-Za-z0-9]+/i, '').trim();
      if (withoutAccNo && withoutAccNo.length < 30) {
        accountLabel = withoutAccNo;
        break;
      }
      container = container.parentElement;
    }
    return { accountId, accountLabel };
  }
  return { accountId: null, accountLabel: null };
}

function captureSnapshot() {
  const positions = scrapePositions();
  if (!positions) {
    console.debug('[TastyFX Tracker] Positions table not found on this page/view.');
    return;
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    url: location.href,
    account: scrapeAccountSummary(),
    identity: scrapeAccountIdentity(),
    positions
  };

  chrome.runtime.sendMessage({ type: 'SNAPSHOT', snapshot }).catch((err) => {
    console.debug('[TastyFX Tracker] Failed to send snapshot:', err);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Manual trigger from the popup ("Capture & Write Now") -- runs the same
  // path as the automatic interval capture, including the file write.
  if (message?.type === 'FORCE_CAPTURE') {
    captureSnapshot();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

let captureTimerId = null;

function startCaptureTimer(minutes) {
  if (captureTimerId) clearInterval(captureTimerId);
  const ms = Math.max(1, minutes || DEFAULT_CAPTURE_INTERVAL_MINUTES) * 60 * 1000;
  captureTimerId = setInterval(captureSnapshot, ms);
}

chrome.storage.local.get('captureIntervalMinutes', ({ captureIntervalMinutes }) => {
  startCaptureTimer(captureIntervalMinutes || DEFAULT_CAPTURE_INTERVAL_MINUTES);
});

// Picks up interval changes made in the popup without needing a tab reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captureIntervalMinutes) {
    startCaptureTimer(changes.captureIntervalMinutes.newValue);
  }
});

// Also capture shortly after load so the popup has data without waiting for the full interval.
setTimeout(captureSnapshot, 3000);
