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
const SERVER_URL = 'https://moreleadnow.com/api/ext';
// Fill in after generating the Caddy Basic Auth password on the server
// (see deploy/README.md, step 6) -- keep this repo private, this is the
// only thing standing between the internet and your account balances.
const SERVER_AUTH = 'Basic ' + btoa('tuan:ngvM4rSEHBYZTXkS5R9b');
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

// Polls a tab's own URL (not its text content) until `predicate` matches or
// the timeout elapses. Used specifically to wait out RF-Trader's SSO
// token-exchange redirect: the tab first lands on
// "pcwebtrader.rf-trader.com/sign-in?Token=..." and only client-side JS
// later navigates it to the real terminal URL, so `waitForTabComplete`
// (which fires on the sign-in page's own load, not the later redirect)
// isn't enough on its own.
function waitForTabUrlChange(tabId, predicate, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (predicate(tab.url || '')) {
          resolve(tab);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(tab);
          return;
        }
        setTimeout(check, 400);
      });
    }
    check();
  });
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

// NOTE: this function is injected into the page via
// chrome.scripting.executeScript, which only serializes the function's OWN
// body -- it can't reference other top-level functions in this file (they
// don't exist in the injected context). simulateClick is therefore defined
// INSIDE, not shared at module scope, even though that duplicates it
// relative to AlphaCapital's copy. (A prior version called an outer
// simulateClick and regressed BOTH tabs to "tab-click-failed" -- the
// ReferenceError it threw is invisible through this API, see
// fnEnsurePanelAndGetBbox's equivalent note in ext-alphacapital/background.js.)
async function fnClickTab(tabName) {
  // Dispatches real mouse events instead of calling el.click() -- confirmed
  // in a sibling extension (AlphaCapital) that native .click() can silently
  // do nothing on elements whose framework listens for real pointer/mouse
  // events rather than the DOM .click() method. Retrying the tab switch
  // with escalating waits made no difference at all here, which timing
  // alone can't explain -- pointing at the click itself never having
  // worked, not a rendering delay.
  function simulateClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
  }
  // Chakra UI tabs (confirmed live: class "chakra-tabs__tab") track the
  // active tab via aria-selected -- reading this after the click tells us
  // definitively whether the click actually changed which tab is selected
  // (a real switch that just needs more time/a different tabIndex
  // afterward) versus never registering with the app's click handler at
  // all (same class of problem as the ReferenceError-caused regression
  // this function already hit once).
  function tabStates() {
    return Array.from(document.querySelectorAll('[role="tab"]')).map((t) => ({
      text: t.textContent.trim(),
      selected: t.getAttribute('aria-selected'),
    }));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const before = tabStates();
  const roleTabs = document.querySelectorAll('[role="tab"]');
  for (const t of roleTabs) {
    if (t.textContent.trim() === tabName) {
      simulateClick(t);
      await sleep(600);
      return { clicked: true, via: 'role-tab', tag: t.tagName, cls: t.className || '', before, after: tabStates() };
    }
  }
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.children.length === 0 && el.textContent.trim() === tabName) {
      simulateClick(el);
      await sleep(600);
      return {
        clicked: true,
        via: 'leaf-text',
        tag: el.tagName,
        cls: el.className || '',
        parentTag: el.parentElement?.tagName,
        parentCls: el.parentElement?.className || '',
        before,
        after: tabStates(),
      };
    }
  }
  return { clicked: false, before };
}

function fnParseAccounts(tabLabel) {
  // Confirmed live (2026-08-15) that an account's status can be "Failed" (a
  // challenge that breached its limits), not just Active/Inactive -- the
  // account still has a real, visible "Details" button same as any other,
  // so excluding it here desyncs tabIndex from fnClickDetailsAt's own count
  // (which is status-agnostic, just every visible Details button). Every
  // account listed AFTER a skipped one then gets clicked one index early,
  // landing on the wrong account with no error -- the exact mechanism
  // behind a real run's account-id-mismatch on three accounts in one scan.
  // Declared inside the function, not at module scope -- this is an
  // injected page function (see the comment above fnIsLoggedIn), so it
  // only has access to its own local scope once serialized into the page.
  const ACCOUNT_STATUS_VALUES = ['Active', 'Inactive', 'Failed', 'Passed', 'Breached', 'Closed', 'Pending'];

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
    if (i + 4 < lines.length && ACCOUNT_STATUS_VALUES.includes(lines[i + 1])) {
      accounts.push({
        account: lines[i],
        status: lines[i + 1],
        program: lines[i + 2],
        balance: lines[i + 3],
        // On the Funded tab this 5th line isn't a real "phase 1/2" the way
        // Challenge cards have -- a funded account has already cleared every
        // phase, so it's not something worth reading off the page at all.
        // Report it as the fixed label "Fund" instead of whatever text
        // happens to sit there.
        phase: tabLabel === 'Funded' ? 'Fund' : lines[i + 4],
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
  // Chakra keeps every tab's TabPanel mounted in the DOM simultaneously
  // (hidden via CSS, not unmounted) -- confirmed live via aria-selected
  // correctly flipping to "Funded" on click, yet still landing on
  // Challenge's first account. Without a visibility filter, this indexes
  // across ALL tabs' Details buttons at once, not just the active tab's --
  // Challenge's buttons sort first in DOM order, so index 0 for ANY other
  // tab always resolved to Challenge's index 0 instead. fnParseAccounts
  // (discovery) didn't have this bug because .innerText, unlike
  // .textContent, already excludes hidden elements' text.
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
    (b) => b.textContent.trim() === 'Details' && b.offsetParent !== null
  );
  if (index < buttons.length) {
    buttons[index].click();
    return true;
  }
  return false;
}


// Also checks whether `expectedAccountId` actually appears on this page --
// confirmed via a real run that a failed tab-switch (dashboard resets to
// its default tab on every fresh navigation, and "Details" buttons are
// indexed per-tab) can silently land on a DIFFERENT account's Details page
// at the same tabIndex, which then gets attributed to the wrong AccountID
// in the CSV with no error at all. This makes that mismatch detectable
// instead of silently trusting whatever balance/equity is on screen.
function fnScrapeBalanceEquity(expectedAccountId) {
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
  const bodyText = document.body.innerText || document.body.textContent || '';
  const accountIdFound = expectedAccountId ? bodyText.includes(expectedAccountId) : null;
  return {
    balance: valueAfter('Balance'),
    equity: valueAfter('Equity'),
    accountIdFound,
    // Debug aid for account-id-mismatch: the existing "re-parse fresh right
    // before clicking" fix still leaves a real mismatch rate (multiple
    // accounts in one run, all exhausting every retry), so this is here to
    // find out WHICH account actually got landed on instead of the
    // requested one -- a first-line snapshot of whatever card is showing.
    mismatchContext: accountIdFound === false ? lines.slice(0, 12) : null,
  };
}

// RF-Trader (a separate origin/SSO deep-link from RF Client Zone) always
// shows the account ID in its own header -- e.g. "22026427572022
// Silver-10,000 phase1", confirmed live via a real screenshot. Mirrors
// fnScrapeBalanceEquity's account-ID check on the RF Client Zone side,
// which this tab has none of on its own.
function fnVerifyRfTraderAccount(expectedAccountId) {
  const bodyText = document.body.innerText || document.body.textContent || '';
  return { accountIdFound: expectedAccountId ? bodyText.includes(expectedAccountId) : null };
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

// Generic version of fnClickPositionsTab -- same two-strategy click (an
// actual [role="tab"] element first, falling back to any leaf element whose
// text matches exactly), just parameterized on the tab label instead of
// hardcoding "Positions".
function fnClickTabByText(tabText) {
  const roleTabs = document.querySelectorAll('[role="tab"]');
  for (const t of roleTabs) {
    if (t.textContent.trim() === tabText && t.offsetParent) {
      t.click();
      return 'role-tab';
    }
  }
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.textContent.trim() === tabText && el.children.length <= 1 && el.offsetParent) {
      el.click();
      return 'text-match';
    }
  }
  return null;
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

// Reads Initial Balance / Starting Equity / Max Daily Drawdown / Today's
// Drawdown off the "Contest stats" tab (same tab bar as "Positions", within
// the same frame -- see fnCheckPositionsFrame). Label-based, same tolerant
// "label and value either on the same line or the next one" approach as
// fnScrapeBalanceEquity, since this renders as plain DOM text like every
// other RF-Trader panel (confirmed live via a real screenshot), not canvas.
function fnScrapeContestStats() {
  function moneyVal(s) {
    if (!s) return '';
    const m = /-?\$?\s*[\d,]+(?:\.\d+)?/.exec(s);
    return m ? m[0].replace('$', '').replace(/,/g, '').trim() : '';
  }
  function pctVal(s) {
    if (!s) return '';
    const m = /-?[\d,]+(?:\.\d+)?/.exec(s);
    return m ? m[0].replace(/,/g, '').trim() : '';
  }
  const text = document.body.innerText || document.body.textContent || '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  function valueAfterLabel(label) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === label) return lines[i + 1] || '';
      if (lines[i].startsWith(label)) {
        const rest = lines[i].slice(label.length).trim();
        return rest || lines[i + 1] || '';
      }
    }
    return '';
  }

  const todayDrawdown = moneyVal(valueAfterLabel("Today's Drawdown"));
  // Debug aid: if this label ever stops matching (a wording change, etc.),
  // show the text actually surrounding Max Daily Drawdown (a reliable
  // anchor) so the real label can be read off directly instead of guessed
  // blind -- this is exactly how "Loss on <date>" got corrected to the
  // real, confirmed-live label "Today's Drawdown" above.
  let maxDdContext = null;
  if (!todayDrawdown) {
    const maxDdIdx = lines.findIndex((l) => l.startsWith('Max Daily Drawdown'));
    if (maxDdIdx >= 0) maxDdContext = lines.slice(maxDdIdx, maxDdIdx + 8);
  }

  // Max Daily Drawdown % / Today's Drawdown % -- same positionally-read
  // 6-line block shape as Max Drawdown/Current Value below (label, "$
  // amount", "N %", next label, amount, pct). Read positionally purely to
  // get at the two % lines; maxDailyDrawdown/todayDrawdown themselves stay
  // on the proven valueAfterLabel path above so this addition can't
  // regress an already-working field. Note: these are the platform's OWN
  // percentages (Today's Drawdown / Today's Starting Equity), NOT the same
  // ratio the dashboard's own Daily DD warning uses (Today's Drawdown / Max
  // Daily Drawdown) -- captured as-is for reference, not fed into warning
  // logic.
  const maxDailyDrawdownIdx = lines.findIndex((l) => l.startsWith('Max Daily Drawdown'));
  const maxDailyDrawdownBlock = maxDailyDrawdownIdx >= 0 ? lines.slice(maxDailyDrawdownIdx, maxDailyDrawdownIdx + 6) : [];
  const todayDrawdownLabelOk = (maxDailyDrawdownBlock[3] || '').startsWith("Today's Drawdown");
  const maxDailyDrawdownPct = pctVal(maxDailyDrawdownBlock[2]);
  const todayDrawdownPct = todayDrawdownLabelOk ? pctVal(maxDailyDrawdownBlock[5]) : '';

  // Contest-wide Max Drawdown / Current Value -- structurally the same
  // 6-line block as Max Daily Drawdown / Today's Drawdown (label, "$
  // amount", "N %", next label, amount, pct, all contiguous -- confirmed
  // live for the daily pair). "Current Value" isn't a unique label on this
  // page (Profit Target has its own "Current Value" row too), so this is
  // read positionally right after "Max Drawdown" rather than searched for
  // globally, which could match the wrong one. "Max Drawdown" itself can't
  // collide with "Max Daily Drawdown" -- they diverge at the 6th
  // character ("Max D[r]..." vs "Max D[a]ily...").
  const maxDrawdownIdx = lines.findIndex((l) => l.startsWith('Max Drawdown'));
  const maxDrawdownBlock = maxDrawdownIdx >= 0 ? lines.slice(maxDrawdownIdx, maxDrawdownIdx + 6) : [];
  const currentValueLabelOk = (maxDrawdownBlock[3] || '').startsWith('Current Value');

  // Profit Target -- same 6-line block shape as Max Drawdown/Current Value
  // above (label, "$ amount", "N %", next label "Current Value", amount,
  // pct -- this page has its own separate Profit Target/Current Value pair,
  // distinct from the contest-wide Max Drawdown/Current Value pair handled
  // above). Only the dollar amount is currently consumed (MainView's
  // "A Target PL" column, also feeding "A Target Equity" =
  // InitialBalance + A Target PL); the % is captured too since it's free
  // from the same
  // block read.
  const profitTargetIdx = lines.findIndex((l) => l.startsWith('Profit Target'));
  const profitTargetBlock = profitTargetIdx >= 0 ? lines.slice(profitTargetIdx, profitTargetIdx + 6) : [];

  return {
    initialBalance: moneyVal(valueAfterLabel('Initial Balance')),
    startingEquity: moneyVal(valueAfterLabel('Starting Equity')),
    maxDailyDrawdown: moneyVal(valueAfterLabel('Max Daily Drawdown')),
    maxDailyDrawdownPct,
    todayDrawdown,
    todayDrawdownPct,
    maxDrawdownAmount: moneyVal(maxDrawdownBlock[1]),
    maxDrawdownPct: pctVal(maxDrawdownBlock[2]),
    currentValueAmount: currentValueLabelOk ? moneyVal(maxDrawdownBlock[4]) : '',
    currentValuePct: currentValueLabelOk ? pctVal(maxDrawdownBlock[5]) : '',
    profitTarget: moneyVal(profitTargetBlock[1]),
    profitTargetPct: pctVal(profitTargetBlock[2]),
    maxDdContext,
    // Fires whenever the positional read above didn't land on "Today's
    // Drawdown" as expected (line 4 of the block), so the real block layout
    // can be read off directly -- same debugging pattern as maxDdContext.
    todayDrawdownPctContext: maxDailyDrawdownIdx >= 0 && !todayDrawdownLabelOk ? maxDailyDrawdownBlock : null,
    // Same debug aid as maxDdContext, but anchored on Max Drawdown -- fires
    // whenever the positional read above didn't land on "Current Value" as
    // expected, so the real block layout can be read off directly.
    maxDrawdownContext: maxDrawdownIdx >= 0 && !currentValueLabelOk ? maxDrawdownBlock : null,
    // Fires when "Profit Target" itself was never found on the page at
    // all, so the raw surrounding text can be read off directly instead of
    // guessed blind -- same debugging pattern as maxDdContext/
    // maxDrawdownContext above.
    profitTargetContext: profitTargetIdx < 0 ? lines.slice(0, 20) : null,
  };
}

async function fnScrapePositions() {
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
  // Class-to-text map for one row's direct "*-info" cells -- lets a wrong
  // field mapping (e.g. StopLossPrice/TakeProfitPrice swapped) be confirmed directly
  // against the real class names instead of guessing blind, same technique
  // that found tastyfx's P/L column bug.
  function sampleCellMap(row) {
    const map = {};
    for (const cell of row.querySelectorAll('[class*="-info"]')) {
      const cls = Array.from(cell.classList).find((c) => c.endsWith('-info'));
      if (!cls || cls in map) continue;
      map[cls] = cell.textContent.trim();
    }
    return map;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // RF-Trader renders "UPL: --" as a placeholder until the live price feed
  // populates it, and .total-info (UPL+fee, rendered by the app itself, not
  // computed here) reflects that same not-ready state -- confirmed via a
  // real run where .total-info read as exactly the transaction fee alone
  // (e.g. "-1.76") because UPL was still "--" at the moment of scraping,
  // while every row whose UPL HAD populated scraped correctly. Poll a few
  // times rather than trusting the first read.
  function scrapeOnce() {
    const rows = document.querySelectorAll('lib-trade-line');
    const positions = [];
    let anyNotReady = false;
    for (const row of rows) {
      const orderText = field(row, '.order-info .main-info');
      const m = ORDER_RE.exec(orderText);
      if (!m) continue;
      const notReady = /UPL:\s*--/.test(field(row, '.pnl-info'));
      if (notReady) anyNotReady = true;
      positions.push({
        PosID: '#' + m[1],
        Symbol: m[2].toUpperCase(),
        Direction: m[3][0].toUpperCase() + m[3].slice(1).toLowerCase(),
        Size: field(row, '.volume-info .main-info').replace('lot', '').trim(),
        SizeUnit: 'lot',
        Opening: field(row, '.open-price-info .main-info'),
        Latest: field(row, '.price-info .main-info'),
        StopLossPrice: slTp(field(row, '.sl-info .main-info')),
        TakeProfitPrice: slTp(field(row, '.tp-info .main-info')),
        PositionPL: money(field(row, '.total-info .main-info')),
        _plNotReady: notReady,
      });
    }

    // RF-Trader's own summary bar shows Balance / UPL / Equity / Used
    // Margin / Free Margin directly -- read UPL (Unrealized P/L) as
    // AccountPL from there instead of computing Equity-Balance ourselves.
    const bodyText = document.body.innerText || '';
    const eqMatch = /Equity\s*\$?\s*([\d,]+\.\d{2})/.exec(bodyText);
    const uplMatch = /UPL\s*\$?\s*(-?[\d,]+\.\d{2})/.exec(bodyText);
    if (rows.length > 0 && !uplMatch) anyNotReady = true;

    return {
      positions,
      equity: eqMatch ? eqMatch[1].replace(/,/g, '') : '',
      accountPL: uplMatch ? uplMatch[1].replace(/,/g, '') : '',
      rowCount: rows.length,
      debugSample: positions.length === 0 && rows.length > 0 ? rows[0].outerHTML.slice(0, 1500) : null,
      sampleCellMap: rows.length > 0 ? sampleCellMap(rows[0]) : null,
      anyNotReady,
    };
  }

  // Confirmed live (2026-08-15) that the old ~4s budget (4 attempts x 1s)
  // wasn't just occasionally tight -- it failed for EVERY position in a
  // real scan, all four attempts exhausted, while the same account's UPL
  // was already populated and stable on a normal (focused, long-open) tab
  // moments later. Widened substantially rather than tweaked, since a
  // systemic full-scan failure implies the real gap is bigger than a
  // couple of seconds, not marginal.
  let result = scrapeOnce();
  let pollAttempts = 0;
  while (result.anyNotReady && pollAttempts < 10) {
    await sleep(1500);
    result = scrapeOnce();
    pollAttempts += 1;
  }
  result.pollAttempts = pollAttempts;
  // Retries exhausted and a row's UPL still never populated -- its
  // .total-info is fee-only, not UPL+fee (see comment above scrapeOnce), so
  // trusting it would silently write a real-looking but wrong PositionPL
  // (confirmed live: RF-205-43891 scraped "-0.44", its transaction fee
  // alone, while the position's actual P&L was around -130). Surface it as
  // genuinely unknown instead, same 'n/a' convention used everywhere else
  // in this codebase for unavailable values.
  for (const p of result.positions) {
    if (p._plNotReady) p.PositionPL = 'n/a';
    delete p._plNotReady;
  }
  return result;
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

async function scrapeRfTraderPositions(tabId, expectedAccountId) {
  await sleep(1500);
  await dismissRouteModal(tabId);
  await sleep(500);
  await execInTab(tabId, fnDismissModals).catch(() => {});
  await sleep(500);

  // Confirmed live (account 22026427572022) that RF-Trader can silently
  // show a DIFFERENT account's position data with no error -- its own SSO
  // deep-link per account isn't guaranteed to land on the one just
  // requested. Bail out here rather than attributing another account's
  // real positions to this one; see fnVerifyRfTraderAccount.
  const verify = await execInTab(tabId, fnVerifyRfTraderAccount, [expectedAccountId]).catch(() => null);
  if (verify && verify.accountIdFound === false) {
    return {
      positions: [], equity: '',
      diag: { reason: 'rf-trader-account-mismatch', expected: expectedAccountId },
    };
  }

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
  const contestTabClickResult = await execInFrame(tabId, targetFrameId, fnClickTabByText, ['Contest stats']).catch(() => null);
  await sleep(1500);
  await execInFrame(tabId, targetFrameId, fnDismissModals).catch(() => {});
  const contestStats = await execInFrame(tabId, targetFrameId, fnScrapeContestStats).catch(() => ({
    initialBalance: '', startingEquity: '', maxDailyDrawdown: '', maxDailyDrawdownPct: '',
    todayDrawdown: '', todayDrawdownPct: '',
    maxDrawdownAmount: '', maxDrawdownPct: '', currentValueAmount: '', currentValuePct: '',
    profitTarget: '', profitTargetPct: '',
    maxDdContext: null, todayDrawdownPctContext: null, maxDrawdownContext: null, profitTargetContext: null,
  }));

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
    accountPL: scraped.accountPL || '',
    initialBalance: contestStats.initialBalance || '',
    startingEquity: contestStats.startingEquity || '',
    maxDailyDrawdown: contestStats.maxDailyDrawdown || '',
    maxDailyDrawdownPct: contestStats.maxDailyDrawdownPct || '',
    todayDrawdown: contestStats.todayDrawdown || '',
    todayDrawdownPct: contestStats.todayDrawdownPct || '',
    maxDrawdownAmount: contestStats.maxDrawdownAmount || '',
    maxDrawdownPct: contestStats.maxDrawdownPct || '',
    currentValueAmount: contestStats.currentValueAmount || '',
    currentValuePct: contestStats.currentValuePct || '',
    profitTarget: contestStats.profitTarget || '',
    profitTargetPct: contestStats.profitTargetPct || '',
    diag: {
      targetFrameId,
      contestTabClickResult,
      clickResult,
      rowCount: scraped.rowCount,
      debugSample: scraped.debugSample,
      sampleCellMap: scraped.sampleCellMap,
      pollAttempts: scraped.pollAttempts,
      stillNotReady: scraped.anyNotReady,
      error: scraped.error,
      maxDdContext: contestStats.maxDdContext,
      todayDrawdownPctContext: contestStats.todayDrawdownPctContext,
      maxDrawdownContext: contestStats.maxDrawdownContext,
      profitTargetContext: contestStats.profitTargetContext,
    },
  };
}

async function scrapeAccount(scanTabId, acc) {
  await chrome.tabs.update(scanTabId, { url: REBELSFUNDING_URL });
  await waitForTabComplete(scanTabId);
  await waitForTextInTab(scanTabId, 'Details', 10000);

  // Every account processed so far in a live run happened to already be on
  // the default tab, so a tab switch that silently failed would never have
  // been caught -- landing on the DEFAULT tab's same tabIndex instead is
  // exactly the account-ID-mismatch failure mode this retries against.
  // Only worth retrying when an actual tab switch is involved; escalating
  // wait per attempt in case that tab's content just needs more time to
  // render than the default tab's did.
  let details = null;
  let tabClickResult = null;
  let lastFreshMatch = null;
  let lastFreshAccountCount = null;
  const attempts = acc.tab ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (acc.tab) {
      tabClickResult = await execInTab(scanTabId, fnClickTab, [acc.tab]);
      await sleep(1000 * (attempt + 1));
    }
    // Re-parse the account list fresh, right here, instead of trusting
    // acc.tabIndex captured once at scan start -- RF Client Zone's account
    // ordering isn't guaranteed stable across every fresh page load (e.g.
    // an account can resort towards the top after being viewed earlier in
    // the same scan), so a stale index can point at a different account's
    // Details button by the time a later account's turn comes up.
    // Re-parsing immediately before the click uses the exact same DOM
    // state the click itself will act on, so the index can't go stale
    // between the two. (An earlier attempt at this fix tried matching each
    // Details button to an account ID by walking up its ancestors -- that
    // backfired: climbing enough levels to reach one account's own card
    // eventually reaches the container ALL cards share, whose text
    // contains every account ID, so it kept matching whichever button
    // came first in DOM order no matter which account was requested.)
    const freshAccounts = await execInTab(scanTabId, fnParseAccounts, [acc.tab]);
    const freshMatch = (freshAccounts || []).find((a) => a.account === acc.account);
    lastFreshMatch = freshMatch ? { account: freshMatch.account, tabIndex: freshMatch.tabIndex } : null;
    lastFreshAccountCount = (freshAccounts || []).length;
    await execInTab(scanTabId, fnClickDetailsAt, [freshMatch ? freshMatch.tabIndex : acc.tabIndex]);
    // "Details" click is an in-app route change, not a real page load --
    // poll for the new content instead of assuming a fixed delay is enough.
    await waitForTextInTab(scanTabId, 'Balance', 10000);
    details = await execInTab(scanTabId, fnScrapeBalanceEquity, [acc.account]);
    if (details?.accountIdFound !== false) break; // matched, or verification wasn't possible either way

    if (attempt < attempts - 1) {
      // Currently sitting on whatever account's Details page this wrongly
      // landed on -- re-navigate to a clean dashboard before retrying
      // rather than clicking again from an already-wrong state.
      await chrome.tabs.update(scanTabId, { url: REBELSFUNDING_URL });
      await waitForTabComplete(scanTabId);
      await waitForTextInTab(scanTabId, 'Details', 10000);
    }
  }

  // If the account ID we expect still isn't anywhere on this Details page
  // after retrying, bail out rather than attributing another account's
  // real balance/positions to this one with no indication anything went
  // wrong.
  if (details?.accountIdFound === false) {
    return {
      rows: [_blankRowForAccount(acc)],
      diag: {
        reason: 'account-id-mismatch',
        expected: acc.account,
        balanceSeen: details?.balance,
        attempts,
        tabClickResult,
        // Whether the LAST attempt's fresh re-parse (right before the
        // click that landed here) actually found the expected account and
        // resolved a tabIndex for it, plus how many accounts it saw total
        // -- tells us whether fnClickDetailsAt clicked the index that
        // fresh parse handed it (a click/DOM-indexing bug) or whether the
        // fresh parse itself already failed to find/resolve the right
        // account (a parsing or resort-timing bug further upstream).
        lastFreshMatch,
        lastFreshAccountCount,
        mismatchContext: details?.mismatchContext,
      },
    };
  }
  const balance = money(details?.balance || acc.balance);
  let equity = money(details?.equity || '');

  let positions = [];
  let accountPL = '';
  let initialBalance = '';
  let startingEquity = '';
  let maxDailyDrawdown = '';
  let maxDailyDrawdownPct = '';
  let todayDrawdown = '';
  let todayDrawdownPct = '';
  let maxDrawdownAmount = '';
  let maxDrawdownPct = '';
  let currentValueAmount = '';
  let currentValuePct = '';
  let profitTarget = '';
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
        // RF-Trader opens on "pcwebtrader.rf-trader.com/sign-in?Token=..."
        // and only redirects to the real terminal once its own JS validates
        // the SSO token -- a live scan showed 5/7 accounts still sitting on
        // that sign-in URL after scrapeRfTraderPositions's ~4s internal
        // frame-detection budget expired (diag.checkedFrames[0].url ending
        // in "/sign-in?Token=..."), while only the first 2 accounts
        // happened to redirect fast enough. Wait explicitly (up to 15s) for
        // the URL to move off /sign-in before starting frame detection,
        // rather than relying on that budget to cover this too.
        await waitForTabUrlChange(rfTab.id, (url) => !url.includes('/sign-in'), 15000);
        const result = await scrapeRfTraderPositions(rfTab.id, acc.account);
        positions = result.positions;
        diag = result.diag;
        if (result.equity) equity = result.equity;
        if (result.accountPL) accountPL = result.accountPL;
        if (result.initialBalance) initialBalance = result.initialBalance;
        if (result.startingEquity) startingEquity = result.startingEquity;
        if (result.maxDailyDrawdown) maxDailyDrawdown = result.maxDailyDrawdown;
        if (result.maxDailyDrawdownPct) maxDailyDrawdownPct = result.maxDailyDrawdownPct;
        if (result.todayDrawdown) todayDrawdown = result.todayDrawdown;
        if (result.todayDrawdownPct) todayDrawdownPct = result.todayDrawdownPct;
        if (result.maxDrawdownAmount) maxDrawdownAmount = result.maxDrawdownAmount;
        if (result.maxDrawdownPct) maxDrawdownPct = result.maxDrawdownPct;
        if (result.currentValueAmount) currentValueAmount = result.currentValueAmount;
        if (result.currentValuePct) currentValuePct = result.currentValuePct;
        if (result.profitTarget) profitTarget = result.profitTarget;
      } finally {
        // Awaited (not fire-and-forget) so the next account's flow can't
        // start while this tab is still mid-close.
        await chrome.tabs.remove(rfTab.id).catch(() => {});
      }
    } else {
      diag = { reason: 'rf-trader-tab-never-opened' };
    }
  } else {
    diag = { reason: 'rf-trader-login-button-not-found' };
  }
  // AccountPL is read directly from RF-Trader's own UPL figure (see
  // fnScrapePositions), not computed from Equity-Balance -- left blank if
  // RF-Trader couldn't be reached at all, rather than derived.

  const isRealMoney = /fund/i.test(acc.program || '') ? 'Yes' : 'No';

  const base = {
    SnapshotDate: fmtDate(new Date()),
    Platform: 'RebelsFunding',
    AccountID: acc.account,
    AccountLabel: acc.program,
    // "1"/"2"/etc -- read straight off the RF Client Zone accounts list
    // (fnParseAccounts already captures this per account, right after
    // Balance in that page's own 5-line block; it just wasn't threaded
    // through to the CSV row until now). Not re-read from RF-Trader's own
    // header (which also shows it, e.g. "...Silver-10,000 phase1") since
    // the Client Zone list is already the source scrapeAccount trusts for
    // every other account-level field here (AccountLabel/Balance/etc).
    Phase: acc.phase || '',
    IsRealMoney: isRealMoney,
    Balance: balance,
    Equity: equity,
    AccountPL: accountPL,
    InitialBalance: initialBalance,
    StartingEquity: startingEquity,
    MaxDailyDrawdown: maxDailyDrawdown,
    MaxDailyDrawdownPct: maxDailyDrawdownPct,
    TodayDrawdown: todayDrawdown,
    TodayDrawdownPct: todayDrawdownPct,
    MaxDrawdownAmount: maxDrawdownAmount,
    MaxDrawdownPct: maxDrawdownPct,
    CurrentValueAmount: currentValueAmount,
    CurrentValuePct: currentValuePct,
    ProfitTarget: profitTarget,
  };

  if (!positions.length) {
    return {
      rows: [{
        ...base, PosID: 'n/a', Symbol: 'n/a', Direction: 'n/a', Size: 'n/a', SizeUnit: 'n/a',
        Opening: 'n/a', Latest: 'n/a', StopLossPrice: 'none', TakeProfitPrice: 'none', PositionPL: accountPL,
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

// Placeholder row for an account that WAS discovered on the dashboard (so
// its ID/program are real) but whose Details/positions couldn't be trusted
// for some other reason -- e.g. an account-ID mismatch, or the scrape
// throwing entirely. More informative than dropping the account's row
// silently: AccountID/AccountLabel stay real, only the balance/position
// fields are blank.
function _blankRowForAccount(acc) {
  return {
    SnapshotDate: fmtDate(new Date()), Platform: 'RebelsFunding', AccountID: acc.account,
    AccountLabel: acc.program, Phase: acc.phase || '', IsRealMoney: '', Balance: '', Equity: '', AccountPL: '',
    InitialBalance: '', StartingEquity: '', MaxDailyDrawdown: '', MaxDailyDrawdownPct: '',
    TodayDrawdown: '', TodayDrawdownPct: '',
    MaxDrawdownAmount: '', MaxDrawdownPct: '', CurrentValueAmount: '', CurrentValuePct: '',
    PosID: '', Symbol: '', Direction: '', Size: '', SizeUnit: '', Opening: '', Latest: '',
    StopLossPrice: '', TakeProfitPrice: '', PositionPL: '',
  };
}

async function runFullScan() {
  await chrome.storage.local.set({ scanStatus: 'running', lastScanError: null });

  // Confirmed live (2026-08-15) that focused: false wasn't just a minor
  // slowdown -- 5/6 accounts in a real scan NEVER got a live UPL reading
  // even after widening the poll budget from ~4s to ~15s (every retry
  // exhausted, no partial progress), while the one account that DID
  // succeed did so instantly (no retries needed at all). That all-or-
  // nothing pattern means more waiting wasn't the fix; RF-Trader's live
  // price feed likely needs real focus to connect/update promptly, so this
  // trades the original "don't steal the user's foreground" goal for
  // actually getting real P&L data -- the window closing at scan end
  // should return focus to whatever was active before.
  const win = await chrome.windows.create({
    url: REBELSFUNDING_URL, type: 'normal', width: SCAN_WINDOW.width, height: SCAN_WINDOW.height, focused: true,
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
      const clickResult = await execInTab(scanTabId, fnClickTab, [tabLabel]);
      if (!clickResult?.clicked) {
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
        rows.push(_blankRowForAccount(acc));
      }
    }

    let writeError = null;
    try {
      const res = await fetch(`${SERVER_URL}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': SERVER_AUTH },
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
