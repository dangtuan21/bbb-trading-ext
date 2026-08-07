// Orchestrator for an AlphaCapital account scan. Ported from
// bbb-trading/trading-back/platforms/alphacapital.py, a Playwright scraper
// already calibrated against real logged-in runs. Unlike every other
// extension in this project, AlphaCapital's cTrader UI renders the actual
// Positions grid (price, size, P/L per row) entirely on <canvas> -- there is
// no DOM text representation of that data at all (confirmed by the Python
// author via direct in-browser inspection). So this extension takes a
// screenshot of the rendered tab and runs OCR (Tesseract.js, in the
// offscreen document -- see offscreen.js) instead of reading DOM text like
// every other platform here. Account-level info (Demo/Live, account ID,
// balance, leverage, and the Balance/Equity/Margin status strip below the
// grid) IS real DOM text and is read normally.
//
// Runs in a dedicated (unfocused) browser window, same rationale as
// RebelsFunding: needs real screen space to render into (this UI's panel
// collapses to ~0 height below a certain viewport size), and
// chrome.tabs.captureVisibleTab needs the tab to be the active tab of some
// window, which a freshly created single-tab window satisfies automatically
// without stealing the user's actual foreground focus.

const ALPHACAPITAL_URL = 'https://app.acg-markets.com/?u=dangtuan21';
const SERVER_URL = 'http://127.0.0.1:8765';
// Tall viewport so the Positions panel has real vertical space to render
// into -- confirmed by the Python author that ~860px tall leaves the panel
// open but its row area at ~0 height.
const SCAN_WINDOW = { width: 1600, height: 1800 };
const TAB_LOAD_TIMEOUT_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (tab.status === 'complete') {
          resolve(tab);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for tab ${tabId} to finish loading`));
          return;
        }
        setTimeout(check, 300);
      });
    }
    check();
  });
}

async function execInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results[0]?.result;
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Runs Tesseract.js (WASM) to OCR a cropped screenshot of the canvas-rendered Positions grid; needs a document/worker-capable context the service worker does not have.',
  });
}

// ---- Injected page functions (must be fully self-contained: no closures
// over background.js variables, only their own args/inline helpers). Each
// bundles its own copies of the shadow-DOM-aware helpers since separate
// executeScript calls don't share scope. ----

// Polls for login (the "Demo"/"Live" account-type label), parses account
// info (ID/balance/leverage) once found, then waits for the app's own
// "Workspace loaded" toast (or a fallback timeout) before returning --
// mirrors _ensure_logged_in + _parse_account_info + _wait_for_workspace_ready.
async function fnEnsureReadyAndGetAccountInfo() {
  function deepLines() {
    const out = [];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
      let style;
      try { style = window.getComputedStyle(node); } catch { style = null; }
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) walk(child);
      }
      for (const child of node.childNodes) walk(child);
    }
    walk(document.body);
    return out;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // See fnEnsurePanelAndGetBbox for why this whole body is wrapped: an
  // uncaught throw here just makes chrome.scripting.executeScript's result
  // for this frame come back with no `.result` at all, with the actual
  // error unrecoverable through that API.
  try {
    let lines = [];
    let loggedIn = false;
    for (let elapsed = 0; elapsed <= 20000; elapsed += 1000) {
      lines = deepLines();
      if (lines.some((l) => l === 'Demo' || l === 'Live')) {
        loggedIn = true;
        break;
      }
      await sleep(1000);
    }
    if (!loggedIn) return { ok: false, reason: 'not-logged-in' };

    let accountInfo = { accountId: 'unknown', isRealMoney: 'No', balance: '', leverage: '' };
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === 'Demo' || lines[i] === 'Live') {
        const isRealMoney = lines[i] === 'Demo' ? 'No' : 'Yes';
        const accountId = lines[i + 1] ? lines[i + 1].trim() : '';
        const balanceRaw = lines[i + 2] ? lines[i + 2].trim() : '';
        const leverage = lines[i + 3] ? lines[i + 3].trim() : '';
        // Balance uses U+00A0 (non-breaking space) as both the "USD"/number
        // separator and the thousands separator, e.g. "USD 10 000.00".
        const balance = balanceRaw.replace('USD', '').replace(/ /g, '').replace(/ /g, '').replace(/,/g, '').trim();
        accountInfo = { accountId, isRealMoney, balance, leverage };
        break;
      }
    }

    let sawToast = false;
    for (let elapsed = 0; elapsed <= 15000; elapsed += 500) {
      if (deepLines().some((l) => l.includes('Workspace loaded'))) {
        sawToast = true;
        break;
      }
      await sleep(500);
    }
    await sleep(sawToast ? 2500 : 4000);

    return { ok: true, accountInfo };
  } catch (err) {
    return { ok: false, reason: 'exception', message: String((err && err.message) || err), stack: err && err.stack };
  }
}

// Reads the "Balance / Equity / Margin / Free margin / ..." status strip
// that sits below the Positions grid, once the Trade Watch panel is open.
// Unlike the grid rows (canvas-rendered, no DOM text -- see the OCR flow
// below), this strip is plain text, so it's read the same shadow-DOM-aware
// way as the top account-info bar in fnEnsureReadyAndGetAccountInfo instead
// of relying on OCR of the screenshot to separate it from Balance.
async function fnReadFooterEquity() {
  function deepLines() {
    const out = [];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
      let style;
      try { style = window.getComputedStyle(node); } catch { style = null; }
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) walk(child);
      }
      for (const child of node.childNodes) walk(child);
    }
    walk(document.body);
    return out;
  }

  const lines = deepLines();
  // Handles both "Equity: USD 10 800.16" as a single text node and "Equity"
  // / "USD 10 800.16" split across two, same as the top balance line uses
  // U+00A0 as both the currency separator and thousands separator.
  for (let i = 0; i < lines.length; i++) {
    const m = /^Equity:?\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const raw = m[1] || lines[i + 1] || '';
    if (!raw) continue;
    const equity = raw.replace('USD', '').replace(/ /g, '').replace(/,/g, '').trim();
    if (equity) return { ok: true, equity };
  }
  return { ok: false, equity: '', diag: { linesSample: lines.slice(0, 40) } };
}

// Opens the "Trade Watch (bottom)" panel (off by default on a fresh
// profile) via the settings menu, closes the menu again (it doesn't
// auto-close), clicks the Positions tab, and returns the crop rect for the
// panel body -- mirrors _ensure_trade_watch_panel_open + _positions_panel_bbox.
async function fnEnsurePanelAndGetBbox() {
  function deepQuery(root, selector) {
    const found = root.querySelector(selector);
    if (found) return found;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const inner = deepQuery(el.shadowRoot, selector);
        if (inner) return inner;
      }
    }
    return null;
  }
  function deepFindByText(root, text) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n.textContent.trim() === text) return n.parentElement;
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const inner = deepFindByText(el.shadowRoot, text);
        if (inner) return inner;
      }
    }
    return null;
  }
  // Lenient version for the "Positions" tab label specifically, which can
  // render as "Positions" or "Positions N" (an open-position-count badge,
  // confirmed via a real screenshot) -- an exact match misses the latter.
  function deepFindByTextPrefix(root, prefix) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n.textContent.trim().startsWith(prefix)) return n.parentElement;
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const inner = deepFindByTextPrefix(el.shadowRoot, prefix);
        if (inner) return inner;
      }
    }
    return null;
  }
  // SVGElement has no native .click() method (only HTMLElement does) --
  // confirmed live: "layoutIcon.click is not a function" against
  // svg#ic_layout. Playwright's own .click() works on any element because
  // it dispatches synthetic mouse events rather than calling a .click()
  // method, so this does the same instead of relying on that method
  // existing.
  function simulateClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
  }
  function clickByExactText(text) {
    const el = deepFindByText(document.body, text);
    if (!el) return false;
    simulateClick(el);
    return true;
  }
  function rowIsChecked(text) {
    const textDiv = deepFindByText(document.body, text);
    if (!textDiv) return null;
    return !!textDiv.parentElement.querySelector('svg#ic_tick');
  }
  function menuIsOpen() {
    return !!deepFindByText(document.body, 'Trade Watch (bottom)');
  }
  function computeBbox() {
    const tabEl = deepFindByTextPrefix(document.body, 'Positions');
    if (!tabEl) return { ok: false, reason: 'positions-tab-not-found', menuOpen: menuIsOpen() };
    const rect = tabEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const top = rect.bottom;
    const height = window.innerHeight - top;
    if (height <= 10) return { ok: false, reason: 'panel-not-rendered', top, viewportHeight: window.innerHeight };
    return {
      ok: true,
      rectDevice: {
        x: 0,
        y: Math.round(top * dpr),
        width: Math.round(window.innerWidth * dpr),
        height: Math.round(height * dpr),
      },
    };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // If anything below throws, chrome.scripting.executeScript's result for
  // this frame just comes back with no `.result` at all -- there's no way
  // to retrieve the underlying error through that API. So every step here
  // is wrapped so the function ALWAYS returns a diagnosable object instead
  // of ever throwing uncaught.
  try {
    // The Trade Watch panel is only "off by default on a fresh profile" per
    // the Python reference -- a saved workspace layout (confirmed via a
    // real screenshot showing the panel already open with a real position)
    // can mean it's already open. Check first and skip the whole
    // settings-menu dance entirely if so, rather than risking it
    // interfering with an already-correct state.
    const already = computeBbox();
    if (already.ok) return already;

    const layoutIcon = deepQuery(document, 'svg#ic_layout');
    if (!layoutIcon) return { ok: false, reason: 'layout-icon-not-found', preCheckReason: already.reason };
    simulateClick(layoutIcon);
    await sleep(500);

    const checked = rowIsChecked('Trade Watch (bottom)');
    if (checked === false) {
      clickByExactText('Trade Watch (bottom)');
      await sleep(1000);
    }

    // Menu doesn't auto-close -- click a neutral chart point and retry
    // until it's actually gone (Escape isn't reliable here either, per the
    // Python reference).
    for (let i = 0; i < 5; i++) {
      if (!menuIsOpen()) break;
      const el = document.elementFromPoint(800, 400);
      if (el) {
        for (const type of ['mousedown', 'mouseup', 'click']) {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 800, clientY: 400 }));
        }
      }
      await sleep(400);
    }

    let clicked = clickByExactText('Positions');
    if (!clicked) {
      const prefixEl = deepFindByTextPrefix(document.body, 'Positions');
      if (prefixEl) {
        simulateClick(prefixEl);
        clicked = true;
      }
    }
    await sleep(1500);

    return { ...computeBbox(), clickedPositionsTab: clicked };
  } catch (err) {
    return { ok: false, reason: 'exception', message: String((err && err.message) || err), stack: err && err.stack };
  }
}

// ---- OCR text parsing (ported from _parse_ocr_positions) ----

// e.g. "AUDUSD", "AUDUSD.pro", "EUR/USD" -- OCR sometimes drops the dot/
// slash or misreads suffixes, so this is intentionally loose. Confirmed live
// that OCR can also drop the leading letter entirely ("AUDUSD" -> "\UDUSD"),
// hence 2-4 chars (not a strict 3) on the first group.
const SYMBOL_RE = /\b([A-Z]{2,4})[./]?([A-Z]{3,4})\b/;
const DIRECTION_RE = /\b(buy|sell)\b/i;
const LOT_RE = /(\d+(?:\.\d+)?)\s*lot/i;
// FX quotes (Entry/TP/SL) render with 4-5 decimal digits, e.g. "0.69460";
// Net USD renders with exactly 2, e.g. "719.71". Classifying by decimal
// precision rather than just "how many decimals appear, in order" is what
// makes this immune to a stray extra token -- confirmed via a real run
// where OCR produced a spurious 4th 5-decimal-digit value after the real
// ones (likely misread icon-area noise to the right of Net USD), which the
// old "last decimal on the line = Net USD" rule grabbed instead of the
// real 2-decimal Net USD value.
//
// Confirmed live that OCR can also drop the decimal point entirely
// ("0.69460" -> "069460") -- PRICE_TOKEN_RE matches both the normal
// 4-5-decimal form AND a bare "0" + 5 digits form in one pass (preserving
// left-to-right order across both), and normalizePriceToken() re-inserts
// the decimal for the latter. Only covers sub-1.0 quotes (majors like
// AUD/USD, EUR/USD) -- a decimal-dropped 3-digit quote (e.g. USD/JPY) isn't
// disambiguated from a stray integer and isn't handled here.
const PRICE_TOKEN_RE = /-?\d+\.\d{4,5}\b|\b0\d{5}\b/g;
const MONEY_RE = /-?\d+\.\d{2}\b/g;

function normalizePriceToken(token) {
  return token.includes('.') ? token : `0.${token.slice(1)}`;
}

function parseOcrPositions(rawText) {
  const positions = [];
  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const symMatch = SYMBOL_RE.exec(line);
    if (!symMatch) continue;
    // Every other platform (and config.json's rules) use slash-separated
    // symbols like "AUD/CHF" -- without the slash here, MainView's exact
    // Platform+AccountID+Symbol rule lookup in compute.js silently never
    // matches, dropping SL/TP/DD/B-match for every AlphaCapital row.
    const symbol = `${symMatch[1]}/${symMatch[2]}`;

    const dirMatch = DIRECTION_RE.exec(line);
    if (!dirMatch) continue; // requiring a direction filters out OCR noise with no real trade row
    const direction = dirMatch[1][0].toUpperCase() + dirMatch[1].slice(1).toLowerCase();

    const lotMatch = LOT_RE.exec(line);
    const size = lotMatch ? lotMatch[1] : '';

    // Grid column order: Created | Symbol | Quantity | Direction | Entry |
    // TP | SL | Net USD. Price-shaped tokens (Entry/TP/SL) and the
    // money-shaped token (Net USD) are matched separately by precision (see
    // PRICE_RE/MONEY_RE above), not just taken in raw left-to-right order --
    // SL often renders as "--" (not set), so the price-token count varies.
    const afterDir = line.slice(dirMatch.index + dirMatch[0].length);
    const prices = (afterDir.match(PRICE_TOKEN_RE) || []).map(normalizePriceToken);
    const money = afterDir.match(MONEY_RE) || [];
    const opening = prices[0] || '';
    const takeProfit = prices[1] || '';
    const stopLoss = prices[2] || '';
    const netUsd = money.length ? money[money.length - 1] : '';

    positions.push({ symbol, direction, size, opening, takeProfit, stopLoss, netUsd, rawLine: line });
  }
  return positions;
}

function fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getFullYear()}`;
}

// ---- Orchestration ----

async function runFullScan() {
  await chrome.storage.local.set({ scanStatus: 'running', lastScanError: null });

  const win = await chrome.windows.create({
    url: ALPHACAPITAL_URL, type: 'normal', width: SCAN_WINDOW.width, height: SCAN_WINDOW.height, focused: false,
  });
  const [tab] = await chrome.tabs.query({ windowId: win.id });
  const tabId = tab.id;

  try {
    await waitForTabComplete(tabId);

    const readyResult = await execInTab(tabId, fnEnsureReadyAndGetAccountInfo);
    if (!readyResult?.ok) {
      await chrome.storage.local.set({
        scanStatus: 'error',
        lastScanError: readyResult?.reason === 'not-logged-in'
          ? 'Not logged in to AlphaCapital. Log in manually in a regular tab, then run the scan again.'
          : `Could not read account info (${readyResult?.reason || 'unknown'}).`,
      });
      return;
    }
    const { accountInfo } = readyResult;

    const bboxResult = await execInTab(tabId, fnEnsurePanelAndGetBbox);
    let positions = [];
    let diag = null;

    if (bboxResult?.ok) {
      await ensureOffscreenDocument();
      const dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'png' });
      const ocrResponse = await chrome.runtime.sendMessage({
        type: 'OCR_REQUEST', dataUrl, rect: bboxResult.rectDevice,
      });
      if (ocrResponse?.ok) {
        positions = parseOcrPositions(ocrResponse.text);
        diag = { rawTextPreview: ocrResponse.text.slice(0, 1500), rect: bboxResult.rectDevice, positionsFound: positions.length };
      } else {
        diag = { reason: 'ocr-failed', error: ocrResponse?.error };
      }
    } else {
      diag = { reason: 'bbox-not-found', detail: bboxResult };
    }

    // Only attempt this once the panel's confirmed open (bboxResult.ok) --
    // the footer strip isn't rendered otherwise.
    let equity = '';
    if (bboxResult?.ok) {
      const equityResult = await execInTab(tabId, fnReadFooterEquity);
      if (equityResult?.ok) equity = equityResult.equity;
    }

    const base = {
      SnapshotDate: fmtDate(new Date()),
      Platform: 'AlphaCapital',
      AccountID: accountInfo.accountId,
      AccountLabel: accountInfo.leverage ? `Leverage ${accountInfo.leverage}` : '',
      IsRealMoney: accountInfo.isRealMoney,
      Balance: accountInfo.balance,
      Equity: equity,
      AccountPL: '',
    };

    const rows = positions.length
      ? positions.map((p) => ({
          ...base,
          PosID: 'n/a',
          Symbol: p.symbol,
          Direction: p.direction,
          Size: p.size || 'n/a',
          SizeUnit: p.size ? 'lot' : 'n/a',
          Opening: p.opening || 'n/a',
          // No separate "current price" column in this grid, only Entry.
          Latest: 'n/a',
          StopLoss: p.stopLoss || 'none',
          TakeProfit: p.takeProfit || 'none',
          PositionPL: p.netUsd,
        }))
      : [{
          ...base, PosID: 'n/a', Symbol: 'n/a', Direction: 'n/a', Size: 'n/a', SizeUnit: 'n/a',
          Opening: 'n/a', Latest: 'n/a', StopLoss: 'none', TakeProfit: 'none', PositionPL: '',
        }];

    let writeError = null;
    try {
      const res = await fetch(`${SERVER_URL}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'alphacapital', rows }),
      });
      const result = await res.json();
      if (!result.ok) writeError = result.error || 'server rejected write';
    } catch (err) {
      writeError = `Could not reach local server: ${err.message}`;
    }

    await chrome.storage.local.set({
      scanStatus: writeError ? 'error' : 'done',
      lastScanError: writeError,
      lastScanTime: new Date().toISOString(),
      lastScanRowCount: rows.length,
      lastScanDiag: diag,
    });
  } catch (err) {
    // Clear lastScanDiag too, not just the error -- otherwise a failure
    // here leaves a PREVIOUS run's diagnostics showing underneath a new,
    // unrelated error message, which is confusing to debug against.
    await chrome.storage.local.set({ scanStatus: 'error', lastScanError: String(err), lastScanDiag: null });
  } finally {
    chrome.windows.remove(win.id).catch(() => {});
  }
}

let scanTimerId = null;
function startScanTimer(minutes) {
  if (scanTimerId) clearInterval(scanTimerId);
  if (!minutes || minutes <= 0) return;
  scanTimerId = setInterval(() => runFullScan().catch(() => {}), minutes * 60 * 1000);
}

chrome.storage.local.get('scanIntervalMinutes', ({ scanIntervalMinutes }) => {
  if (scanIntervalMinutes) startScanTimer(scanIntervalMinutes);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.scanIntervalMinutes) {
    startScanTimer(changes.scanIntervalMinutes.newValue);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'RUN_SCAN_NOW') {
    runFullScan().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
