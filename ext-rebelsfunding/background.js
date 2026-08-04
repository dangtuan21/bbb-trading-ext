// Orchestrator for a full RebelsFunding account scan. Ported from
// bbb-trading/trading-back/platforms/rebelsfunding.py (a proven Playwright
// scraper for this exact site) -- selectors, flow, and field logic mirror
// that file closely. Runs the whole scan in a dedicated wide browser window
// (RF-Trader hides its Positions tab bar below ~2400px viewport width) so it
// doesn't hijack whatever window the user is actually working in.
//
// Unlike tastyfx's content-script-watches-an-open-tab model, this drives
// navigation itself via chrome.tabs + chrome.scripting.executeScript, since
// the data lives across two different origins (RF Client Zone for
// Balance/account list, RF-Trader for live positions/Equity) and multiple
// accounts that have to be visited one at a time.

const REBELSFUNDING_URL = 'https://rf-zone.rebelsfunding.com/';
// Shared with the tastyfx extension -- see ext-server/server.js.
const SERVER_URL = 'http://127.0.0.1:8765';
const SCAN_WINDOW = { width: 2400, height: 1200 };
const TAB_LOAD_TIMEOUT_MS = 20000;
const RF_TRADER_TAB_TIMEOUT_MS = 10000;

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

// Polls the tab's visible text for `text` appearing, rather than a fixed
// sleep -- SPA route transitions (e.g. clicking "Details") don't fire a real
// page-load event, so waitForTabComplete alone can't tell when the new
// content has actually rendered. Mirrors the Python scraper's
// page.wait_for_selector("text=...") calls.
async function waitForTextInTab(tabId, text, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await execInTab(tabId, (t) => document.body.innerText.includes(t), [text]).catch(() => false);
    if (found) return true;
    await sleep(400);
  }
  return false;
}

function waitForNewTab(openerTabId, timeoutMs = RF_TRADER_TAB_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onCreated.removeListener(listener);
      resolve(null);
    }, timeoutMs);

    function listener(tab) {
      if (done || tab.openerTabId !== openerTabId) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onCreated.removeListener(listener);
      resolve(tab);
    }
    chrome.tabs.onCreated.addListener(listener);
  });
}

async function execInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results[0]?.result;
}

async function execInAllFrames(tabId, func, args = []) {
  return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
}

async function execInFrame(tabId, frameId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args });
  return results[0]?.result;
}

// ---- Injected page functions (must be fully self-contained: no closures
// over background.js variables, only their own `args`). ----

function fnIsLoggedIn() {
  const els = document.querySelectorAll('button, [role="button"], a');
  for (const el of els) {
    if (el.textContent.trim() === 'Details') return true;
  }
  return false;
}

function fnClickTab(tabName) {
  const roleTabs = document.querySelectorAll('[role="tab"]');
  for (const t of roleTabs) {
    if (t.textContent.trim() === tabName) {
      t.click();
      return true;
    }
  }
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.children.length === 0 && el.textContent.trim() === tabName) {
      el.click();
      return true;
    }
  }
  return false;
}

function fnParseAccounts(tabLabel) {
  function findContainerWithText(marker) {
    const articles = document.querySelectorAll('article');
    for (const el of articles) {
      if (el.textContent.includes(marker)) return el;
    }
    return null;
  }
  const container = findContainerWithText('Details') || document.body;
  const text = container.innerText || container.textContent || '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const accounts = [];
  let i = 0;
  let tabIndex = 0;
  while (i < lines.length) {
    if (lines[i] === 'Details') {
      i += 1;
      continue;
    }
    if (i + 4 < lines.length && (lines[i + 1] === 'Active' || lines[i + 1] === 'Inactive')) {
      accounts.push({
        account: lines[i],
        status: lines[i + 1],
        program: lines[i + 2],
        balance: lines[i + 3],
        phase: lines[i + 4],
        tab: tabLabel,
        tabIndex,
      });
      tabIndex += 1;
      i += 5;
      if (i < lines.length && lines[i] === 'Details') i += 1;
    } else {
      i += 1;
    }
  }
  return accounts;
}

function fnClickDetailsAt(index) {
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
    (b) => b.textContent.trim() === 'Details'
  );
  if (index < buttons.length) {
    buttons[index].click();
    return true;
  }
  return false;
}

function fnScrapeBalanceEquity() {
  function findContainerWithText(marker) {
    const articles = document.querySelectorAll('article');
    for (const el of articles) {
      if (el.textContent.includes(marker)) return el;
    }
    return null;
  }
  const container = findContainerWithText('Balance') || document.body;
  const text = container.innerText || container.textContent || '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  function valueAfter(label) {
    const idx = lines.indexOf(label);
    return idx >= 0 && idx + 1 < lines.length ? lines[idx + 1] : '';
  }
  return { balance: valueAfter('Balance'), equity: valueAfter('Equity') };
}

function fnClickRFTraderLogin() {
  const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
  for (const el of candidates) {
    if (el.textContent.trim() === 'RF-Trader Login') {
      el.click();
      return true;
    }
  }
  for (const el of candidates) {
    if (el.textContent.includes('RF-Trader Login')) {
      el.click();
      return true;
    }
  }
  return false;
}

function fnDismissModals() {
  function clickByText(text, exact) {
    const all = document.querySelectorAll('button, [role="button"], a');
    for (const el of all) {
      const t = el.textContent.trim();
      if ((exact ? t === text : t.includes(text)) && el.offsetParent) {
        try {
          el.click();
          return true;
        } catch {
          // ignore
        }
      }
    }
    return false;
  }
  const installMarker = Array.from(document.querySelectorAll('*')).find(
    (el) => el.children.length === 0 && el.textContent.includes('Would you like to install the application?')
  );
  if (installMarker) clickByText('No', true);

  const labels = [
    'Close', 'Got it', 'I understand', 'I Agree', 'Agree', 'Accept', 'OK', 'Dismiss',
    'No thanks', 'Not now', 'Maybe later', 'Later', 'Skip for now', 'Continue in browser', 'Continue', 'Skip',
  ];
  for (const label of labels) clickByText(label, false);
  return true;
}

function fnCheckPositionsFrame() {
  const text = document.body.innerText || '';
  return {
    hasPositionsWord: text.includes('Positions'),
    hasHeaders: ['Volume', 'Margin', 'T/P', 'S/L'].some((h) => text.includes(h)),
    url: location.href,
  };
}

function fnClickPositionsTab() {
  const roleTabs = document.querySelectorAll('[role="tab"]');
  for (const t of roleTabs) {
    if (t.textContent.trim() === 'Positions' && t.offsetParent) {
      t.click();
      return 'role-tab';
    }
  }
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.textContent.trim() === 'Positions' && el.children.length <= 1 && el.offsetParent) {
      el.click();
      return 'text-match';
    }
  }
  return null;
}

function fnScrapePositions() {
  const ORDER_RE = /^#(\d+)\s+([A-Z]{3}\/[A-Z]{3})\s+(Buy|Sell)/i;
  function field(row, selector) {
    const el = row.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }
  function money(s) {
    return (s || '').replace('$', '').replace(/,/g, '').trim();
  }
  function slTp(v) {
    const t = (v || '').trim();
    return !t || t === '-' || t === '--' || t === 'n/a' ? 'none' : t;
  }

  const rows = document.querySelectorAll('lib-trade-line');
  const positions = [];
  for (const row of rows) {
    const orderText = field(row, '.order-info .main-info');
    const m = ORDER_RE.exec(orderText);
    if (!m) continue;
    positions.push({
      PosID: '#' + m[1],
      Symbol: m[2].toUpperCase(),
      Direction: m[3][0].toUpperCase() + m[3].slice(1).toLowerCase(),
      Size: field(row, '.volume-info .main-info').replace('lot', '').trim(),
      SizeUnit: 'lot',
      Opening: field(row, '.open-price-info .main-info'),
      Latest: field(row, '.price-info .main-info'),
      StopLoss: slTp(field(row, '.sl-info .main-info')),
      TakeProfit: slTp(field(row, '.tp-info .main-info')),
      PositionPL: money(field(row, '.total-info .main-info')),
    });
  }

  const bodyText = document.body.innerText || '';
  const eqMatch = /Equity\s*\$?\s*([\d,]+\.\d{2})/.exec(bodyText);

  return {
    positions,
    equity: eqMatch ? eqMatch[1].replace(/,/g, '') : '',
    rowCount: rows.length,
    debugSample: positions.length === 0 && rows.length > 0 ? rows[0].outerHTML.slice(0, 1500) : null,
  };
}

// ---- Orchestration ----

function money(s) {
  return (s || '').replace('$', '').replace(/,/g, '').trim();
}

async function dismissRouteModal(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !tab.url.includes('(modal:')) return;
  const cleanUrl = tab.url.replace(/\(modal:[^)]*\)/, '').replace(/\/$/, '');
  await chrome.tabs.update(tabId, { url: cleanUrl });
  await waitForTabComplete(tabId);
  await sleep(1000);
}

async function scrapeRfTraderPositions(tabId) {
  await sleep(1500);
  await dismissRouteModal(tabId);
  await sleep(500);
  await execInTab(tabId, fnDismissModals).catch(() => {});
  await sleep(500);

  let targetFrameId = null;
  let checkedFrames = [];
  for (let attempt = 0; attempt < 2 && targetFrameId === null; attempt++) {
    const frameResults = await execInAllFrames(tabId, fnCheckPositionsFrame).catch(() => []);
    checkedFrames = frameResults.map((r) => ({ frameId: r.frameId, ...(r.result || {}) }));
    // hasHeaders alone (Volume/Margin/T/P/S/L column headers) is a reliable
    // signal that this frame IS the trading grid -- confirmed by a real scan
    // where hasHeaders was true but hasPositionsWord was false (the "Positions"
    // tab label likely renders via CSS text-transform, so the literal DOM/
    // innerText case doesn't match a plain "Positions" substring check).
    // Prefer a frame with both, but don't require hasPositionsWord.
    const withBoth = checkedFrames.find((f) => f.hasPositionsWord && f.hasHeaders);
    const withHeaders = checkedFrames.find((f) => f.hasHeaders);
    const withWord = checkedFrames.find((f) => f.hasPositionsWord);
    const match = withBoth || withHeaders || withWord;
    if (match) {
      targetFrameId = match.frameId;
    } else {
      await sleep(1500);
    }
  }

  if (targetFrameId === null) {
    return { positions: [], equity: '', diag: { reason: 'no-positions-frame', checkedFrames } };
  }

  await execInFrame(tabId, targetFrameId, fnDismissModals).catch(() => {});
  const clickResult = await execInFrame(tabId, targetFrameId, fnClickPositionsTab).catch(() => null);
  await sleep(1500);
  await execInFrame(tabId, targetFrameId, fnDismissModals).catch(() => {});
  await sleep(500);

  const scraped = await execInFrame(tabId, targetFrameId, fnScrapePositions).catch((err) => ({
    positions: [], equity: '', rowCount: 0, error: String(err),
  }));

  return {
    positions: scraped.positions || [],
    equity: scraped.equity || '',
    diag: {
      targetFrameId,
      clickResult,
      rowCount: scraped.rowCount,
      debugSample: scraped.debugSample,
      error: scraped.error,
    },
  };
}

async function scrapeAccount(scanTabId, acc) {
  await chrome.tabs.update(scanTabId, { url: REBELSFUNDING_URL });
  await waitForTabComplete(scanTabId);
  await waitForTextInTab(scanTabId, 'Details', 10000);

  if (acc.tab) {
    await execInTab(scanTabId, fnClickTab, [acc.tab]);
    await sleep(800);
  }
  await execInTab(scanTabId, fnClickDetailsAt, [acc.tabIndex]);
  // "Details" click is an in-app route change, not a real page load -- poll
  // for the new content instead of assuming a fixed delay is enough.
  await waitForTextInTab(scanTabId, 'Balance', 10000);

  const details = await execInTab(scanTabId, fnScrapeBalanceEquity);
  const balance = money(details?.balance || acc.balance);
  let equity = money(details?.equity || '');

  let positions = [];
  let diag = null;
  // waitForNewTab must start listening BEFORE the click, not after -- the
  // click's window.open() can fire (and the tabs.onCreated event with it)
  // synchronously within the same tick execInTab's own await resolves in,
  // so starting the listener afterward is a real race that dropped 5/7
  // accounts in a live run. Calling it here (unawaited) registers the
  // listener immediately; only the `await` below is deferred.
  const newTabPromise = waitForNewTab(scanTabId);
  const clicked = await execInTab(scanTabId, fnClickRFTraderLogin);
  if (clicked) {
    const rfTab = await newTabPromise;
    if (rfTab) {
      try {
        await waitForTabComplete(rfTab.id);
        const result = await scrapeRfTraderPositions(rfTab.id);
        positions = result.positions;
        diag = result.diag;
        if (result.equity) equity = result.equity;
      } finally {
        chrome.tabs.remove(rfTab.id).catch(() => {});
      }
    } else {
      diag = { reason: 'rf-trader-tab-never-opened' };
    }
  } else {
    diag = { reason: 'rf-trader-login-button-not-found' };
  }

  let accountPL = '';
  const balNum = parseFloat(balance);
  const eqNum = parseFloat(equity);
  if (!Number.isNaN(balNum) && !Number.isNaN(eqNum)) {
    accountPL = Math.round((eqNum - balNum) * 100) / 100;
  }

  const isRealMoney = /fund/i.test(acc.program || '') ? 'Yes' : 'No';

  const base = {
    SnapshotDate: fmtDate(new Date()),
    Platform: 'RebelsFunding',
    AccountID: acc.account,
    AccountLabel: acc.program,
    IsRealMoney: isRealMoney,
    Balance: balance,
    Equity: equity,
    AccountPL: accountPL,
  };

  if (!positions.length) {
    return {
      rows: [{
        ...base, PosID: 'n/a', Symbol: 'n/a', Direction: 'n/a', Size: 'n/a', SizeUnit: 'n/a',
        Opening: 'n/a', Latest: 'n/a', StopLoss: 'none', TakeProfit: 'none', PositionPL: accountPL,
      }],
      diag,
    };
  }

  return {
    rows: positions.map((p) => ({ ...base, ...p })),
    diag,
  };
}

function fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getFullYear()}`;
}

async function runFullScan() {
  await chrome.storage.local.set({ scanStatus: 'running', lastScanError: null });

  const win = await chrome.windows.create({
    url: REBELSFUNDING_URL, type: 'normal', width: SCAN_WINDOW.width, height: SCAN_WINDOW.height, focused: false,
  });
  const [scanTab] = await chrome.tabs.query({ windowId: win.id });
  const scanTabId = scanTab.id;

  const diagnostics = [];
  try {
    await waitForTabComplete(scanTabId);
    await waitForTextInTab(scanTabId, 'Details', 10000).catch(() => {});

    const loggedIn = await execInTab(scanTabId, fnIsLoggedIn);
    if (!loggedIn) {
      await chrome.storage.local.set({
        scanStatus: 'error',
        lastScanError: 'Not logged in to RF Client Zone. Log in manually in a regular tab, then run the scan again.',
      });
      return;
    }

    const allAccounts = [];
    const seenIds = new Set();
    for (const tabLabel of ['Challenge', 'Funded']) {
      const clicked = await execInTab(scanTabId, fnClickTab, [tabLabel]);
      if (!clicked) {
        diagnostics.push({ tab: tabLabel, reason: 'tab-click-failed' });
        continue;
      }
      await sleep(800);
      const accounts = await execInTab(scanTabId, fnParseAccounts, [tabLabel]);
      for (const acc of accounts || []) {
        if (!seenIds.has(acc.account)) {
          seenIds.add(acc.account);
          allAccounts.push(acc);
        }
      }
    }

    const active = allAccounts.filter((a) => a.status === 'Active');
    const rows = [];
    for (const acc of active) {
      try {
        const result = await scrapeAccount(scanTabId, acc);
        rows.push(...result.rows);
        if (result.diag) diagnostics.push({ account: acc.account, ...result.diag });
      } catch (err) {
        diagnostics.push({ account: acc.account, reason: 'scrape-threw', error: String(err) });
        rows.push({
          SnapshotDate: fmtDate(new Date()), Platform: 'RebelsFunding', AccountID: acc.account,
          AccountLabel: acc.program, IsRealMoney: '', Balance: '', Equity: '', AccountPL: '',
          PosID: '', Symbol: '', Direction: '', Size: '', SizeUnit: '', Opening: '', Latest: '',
          StopLoss: '', TakeProfit: '', PositionPL: '',
        });
      }
    }

    let writeError = null;
    try {
      const res = await fetch(`${SERVER_URL}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'rebelsfunding', rows }),
      });
      const result = await res.json();
      if (!result.ok) writeError = result.error || 'server rejected scan';
    } catch (err) {
      writeError = `Could not reach local server: ${err.message}`;
    }

    await chrome.storage.local.set({
      scanStatus: writeError ? 'error' : 'done',
      lastScanError: writeError,
      lastScanTime: new Date().toISOString(),
      lastScanAccountCount: active.length,
      lastScanRowCount: rows.length,
      lastScanDiagnostics: diagnostics,
    });
  } catch (err) {
    await chrome.storage.local.set({
      scanStatus: 'error',
      lastScanError: String(err),
      lastScanDiagnostics: diagnostics,
    });
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
