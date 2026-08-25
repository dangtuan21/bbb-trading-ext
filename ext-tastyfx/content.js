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

function isVisible(el) {
  return !!(el.offsetParent || el.getClientRects().length);
}

// isVisible(el) alone can wrongly call a genuinely on-screen row "hidden"
// if the row element itself is `display: contents` -- a real pattern for
// CSS-grid-based tables, where the row wrapper is deliberately given no box
// of its own (offsetParent AND getClientRects() both come back empty for
// it) purely so its cells can slot directly into the parent grid's column
// tracks, while those cells are still fully rendered. Falling back to "does
// ANY child have a real box" covers that case without having to know
// whether this specific row happens to use it.
function hasVisibleLayout(el) {
  return isVisible(el) || Array.from(el.children).some(isVisible);
}

// The header-row search itself (candidates = every element whose direct
// children contain MARKET/SIZE/LATEST, avoiding hashed/unstable class
// names) now lives inline in scrapePositions() below, not as a standalone
// function -- it needs to report candidateHeaderRowCount/chosenCandidateIndex
// diagnostics alongside the element it picks, not just return the element.
//
// Prefers a visible match over a hidden one, same reason as
// scrapeAccountSummary below: IG keeps hidden duplicate copies of parts of
// this page in the DOM (e.g. for other responsive breakpoints, or an
// inactive workspace tab's own copy of the Positions grid), and those don't
// get reactively updated once hidden -- suspected cause of P/L staying
// wrong even right after "Write Now" force-re-scrapes, since re-running the
// same document-order query would just re-read the same frozen hidden copy
// every time if it happens to sort before the live one. Not yet confirmed,
// though -- see the diagnostics captureSnapshot now records instead of
// guessing further.
//
// Falls back to the first shape-matching candidate regardless of
// visibility if NO candidate passes the visibility check at all -- if
// hasVisibleLayout ever misjudges IG's real markup (a redesign, a new grid
// library, whatever), that must degrade to the old "maybe wrong row"
// behavior, not silently return null and stop capturing entirely (which is
// worse: captureSnapshot bails out before ever messaging background.js, so
// no write happens at all, not even a stale one).

const MARKET_PATTERN = /^[A-Z]{2,4}\/[A-Z]{2,4}$/;

// IG tags each cell with a semantic data-automation attribute (instrumentName,
// dealSize, openLevel, latest, stopLevel, ...) and a "cell-<field>" class as
// fallback. Keying off those is far more reliable than positional alignment,
// since the header row has extra non-data columns (checkbox/options) that
// don't exist in each data row, throwing off any index-based mapping.
//
// Also reports `duplicateKeys` -- automation/class keys seen on MORE THAN
// ONE cell within this single row. That means this ONE row itself (not a
// separate hidden duplicate grid -- the different, ROW-level possibility
// scrapePositions already guards against) renders more than one copy of a
// field, e.g. a hidden mobile-card sub-layout nested inside the same row as
// the visible desktop layout -- confirmed via a synthetic test to be a real
// way this can go wrong, not just a theoretical one. When a key does have
// more than one cell, this prefers a VISIBLE cell's text over a hidden
// one's -- same "prefer visible" principle scrapePositions already applies
// one level up, just applied here at the individual-cell level too. Only
// falls back to plain last-one-wins when NONE of that key's cells are
// visible (nothing better to prefer).
function extractCellMap(row) {
  const byKey = {};
  for (const cell of row.children) {
    const automationKey = cell.getAttribute('data-automation');
    const classKey = Array.from(cell.classList).find((c) => c.startsWith('cell-'));
    const text = cell.textContent.trim();
    const visible = isVisible(cell);
    for (const key of [automationKey, classKey]) {
      if (!key) continue;
      (byKey[key] ??= []).push({ text, visible });
    }
  }

  const map = {};
  const duplicateKeys = [];
  for (const [key, entries] of Object.entries(byKey)) {
    if (entries.length > 1) duplicateKeys.push(key);
    const visibleEntries = entries.filter((e) => e.visible);
    map[key] = (visibleEntries.length ? visibleEntries : entries).at(-1).text;
  }
  return { map, duplicateKeys };
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

// Returns both the parsed positions AND a diagnostics object -- two rounds
// of guessing at IG's DOM (a hidden duplicate GRID, then a `display:
// contents` header row) haven't actually fixed a wrong P/L, so instead of
// guessing a third time, this surfaces exactly what was found: how many row
// elements matched, and the FIRST row's raw, un-aliased cell map (every
// data-automation/cell-* key IG actually put there, plus any duplicateKeys
// -- see extractCellMap above). Sent up to the popup via captureSnapshot
// regardless of whether a usable snapshot could be built, so the next
// report back is a screenshot of ground truth instead of another guess.
function extractRows(headerRow) {
  const grid = headerRow.closest('.ig-grid') || headerRow.parentElement?.parentElement || headerRow.parentElement;
  if (!grid) return { positions: [], diag: { reason: 'no-grid-container-found' } };

  let rowEls = Array.from(grid.querySelectorAll('.ig-grid_row'));
  let rowSource = 'ig-grid_row';

  // Fallback: scan for any element directly containing a currency-pair-shaped
  // market cell, in case the "ig-grid_row" class isn't present.
  if (rowEls.length === 0) {
    rowEls = Array.from(grid.querySelectorAll('*')).filter((el) =>
      Array.from(el.children).some((c) => MARKET_PATTERN.test(c.textContent.trim()))
    );
    rowSource = 'market-pattern-fallback';
  }

  const positions = [];
  let firstRowCellMap = null;
  let firstRowDuplicateKeys = null;
  for (const row of rowEls) {
    const { map, duplicateKeys } = extractCellMap(row);
    if (firstRowCellMap === null) {
      firstRowCellMap = map;
      firstRowDuplicateKeys = duplicateKeys;
    }
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

  return {
    positions,
    diag: { rowSource, rowElCount: rowEls.length, firstRowCellMap, firstRowDuplicateKeys },
  };
}

// Only computed when the normal candidate search below finds absolutely
// nothing (candidateHeaderRowCount: 0) -- confirmed live to actually happen
// (real diagnostics from a real scan, not a guess), which is a more
// fundamental miss than anything the visible/hidden-duplicate fixes above
// address: those all assume `document.querySelectorAll('body *')` at least
// SEES the real header row somewhere in the tree, just possibly the wrong
// (hidden) copy of it. Zero candidates means it isn't seeing ANY copy, real
// or hidden, which points at one of two very different problems:
//
//  - The grid lives inside an <iframe> -- a separate document entirely, so
//    nothing in the top frame's DOM can ever see it. iframeCount below
//    catches this directly.
//  - The grid lives inside a Shadow DOM -- querySelectorAll can't pierce a
//    shadow root. shadowRootHostCount below catches this directly (counts
//    elements with a non-null, so only *open* shadow roots are visible to
//    this at all -- a closed one is undetectable from outside by design).
//
// bodyInnerTextHas* were meant to distinguish the two on the theory that
// innerText reflects Shadow DOM content but not iframe content -- checked
// against a synthetic Shadow DOM case before shipping, and that theory
// didn't hold (innerText came back without the shadow content in that
// test, same as the iframe case). Left in anyway since it's cheap and still
// useful for a DIFFERENT question -- whether "MARKET"/"SIZE"/"LATEST" are
// visually present at all -- just don't read it as iframe-vs-shadow
// evidence; use iframeCount/shadowRootHostCount for that instead.
//
// The exact-vs-substring question this used to check for itself is now
// answered by construction -- scrapePositions' own candidate search below
// already uses hasLabelSubstring, so a 0-candidate result here means even
// substring matching found nothing (candidateHeaderRowCount in the caller's
// diag already says as much; no separate substringMatchCandidateCount to
// recompute here anymore). What's left worth checking: is the content
// visually present at all (bodyInnerTextHas*), and does it live inside an
// iframe or Shadow DOM (iframeCount/shadowRootHostCount) -- either of which
// querySelectorAll genuinely cannot see into, unlike a plain matching miss.
function diagnoseNoHeaderRowFound() {
  const bodyText = (document.body.innerText || '').toUpperCase();
  return {
    bodyInnerTextHasMarket: bodyText.includes('MARKET'),
    bodyInnerTextHasSize: bodyText.includes('SIZE'),
    bodyInnerTextHasLatest: bodyText.includes('LATEST'),
    iframeCount: document.querySelectorAll('iframe').length,
    iframeSrcs: Array.from(document.querySelectorAll('iframe')).slice(0, 5).map((f) => f.src || '(no src)'),
    shadowRootHostCount: Array.from(document.querySelectorAll('*')).filter((el) => el.shadowRoot).length,
  };
}

// Matches a header cell's label on SUBSTRING, not exact equality --
// confirmed via a real scan's own diagnostics that exact matching was the
// actual bug, not a guess: that scan reported candidateHeaderRowCount: 0
// (exact) alongside substringMatchCandidateCount: 1 (substring) on the SAME
// live page at the SAME moment, meaning the real header row was sitting
// right there in the top-level document the whole time -- exact matching
// on texts.includes('SIZE') just could never see it. This page's real
// "SIZE" header renders with a sort-direction indicator glued onto the
// same cell (e.g. "SIZE ⌃"), which no exact string ever matches; a
// synthetic test reproducing exactly that shape confirmed substring
// matching finds it while exact matching doesn't. (That same scan also
// reported one stray iframe and one stray Shadow DOM host elsewhere on the
// page -- unrelated to the Positions grid itself, which was never inside
// either one.)
function hasLabelSubstring(el, label) {
  return Array.from(el.children).some((c) => c.textContent.trim().toUpperCase().includes(label));
}

function scrapePositions() {
  const candidates = Array.from(document.querySelectorAll('body *')).filter((el) => {
    if (el.children.length < 5) return false;
    return hasLabelSubstring(el, 'MARKET') && hasLabelSubstring(el, 'SIZE') && hasLabelSubstring(el, 'LATEST');
  });
  const visibleIndex = candidates.findIndex(hasVisibleLayout);
  const chosenIndex = visibleIndex >= 0 ? visibleIndex : (candidates.length ? 0 : -1);

  const diag = {
    candidateHeaderRowCount: candidates.length,
    visibleCandidateCount: candidates.filter(hasVisibleLayout).length,
    chosenCandidateIndex: chosenIndex,
    chosenWasVisible: chosenIndex >= 0 ? hasVisibleLayout(candidates[chosenIndex]) : null,
  };

  // Should rarely trigger now that the search above already uses substring
  // matching -- kept as a defensive fallback (and its own diagnostics) for
  // if IG's markup changes again in some other way (e.g. genuinely moves
  // the grid into an iframe/Shadow DOM one day), so a future miss still
  // reports something concrete instead of going silent again.
  if (chosenIndex < 0) {
    return {
      positions: null,
      diag: { ...diag, reason: 'no-header-row-found', ...diagnoseNoHeaderRowFound() },
    };
  }

  const { positions, diag: rowsDiag } = extractRows(candidates[chosenIndex]);
  return { positions, diag: { ...diag, ...rowsDiag } };
}

// Best-effort scrape of the account summary strip (Funds, Profit/Loss, Margin,
// Available, Cash Rebate). Looks for label/value pairs by known labels.
// IG's UI keeps hidden duplicate copies of this strip in the DOM (e.g. for
// other responsive breakpoints), which don't get reactively updated -- so
// this must skip hidden matches and take the first *visible* one, not just
// the last one found in document order. (isVisible itself now lives above,
// next to findHeaderRow, which needs the exact same guard for the Positions
// grid -- see the comment there.)
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
  const { positions, diag } = scrapePositions();

  // Stored directly here (not routed through background.js/the server),
  // and unconditionally -- regardless of whether a usable snapshot could be
  // built below. This is what makes the diagnostics visible in the popup
  // (see popup.js) even on a run that finds nothing at all, which a
  // SNAPSHOT message alone never would: SNAPSHOT only gets sent, and
  // storage only otherwise gets touched, on the success path further down.
  chrome.storage.local.set({ lastScanDiagnostics: diag, lastScanTime: new Date().toISOString() });

  if (!positions || !positions.length) {
    console.debug('[TastyFX Tracker] Positions table not found on this page/view.', diag);
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
