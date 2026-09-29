const SERVER_URL = 'https://moreleadnow.com/api/ext';
// Fill in after generating the Caddy Basic Auth password on the server
// (see deploy/README.md, step 6) -- keep this repo private, this is the
// only thing standing between the internet and your account balances.
const SERVER_AUTH = 'Basic ' + btoa('tuan:ngvM4rSEHBYZTXkS5R9b');

const statusBox = document.getElementById('statusBox');
const lastWriteEl = document.getElementById('lastWrite');
const intervalInput = document.getElementById('intervalInput');
const saveIntervalBtn = document.getElementById('saveIntervalBtn');
const actionLog = document.getElementById('actionLog');
const positionsTable = document.getElementById('positionsTable');
const positionsBody = document.getElementById('positionsBody');
const forceCaptureBtn = document.getElementById('forceCaptureBtn');
const lastErrorRow = document.getElementById('lastErrorRow');
const lastErrorEl = document.getElementById('lastError');
const noPositionsMsg = document.getElementById('noPositionsMsg');
const lastScanEl = document.getElementById('lastScan');
const diagLog = document.getElementById('diagLog');

function fmtTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleTimeString();
}

async function refreshStatus() {
  const data = await chrome.storage.local.get([
    'latestSnapshot', 'lastWriteTime', 'captureIntervalMinutes', 'lastWriteError',
    'lastScanDiagnostics', 'lastScanTime'
  ]);

  if (data.lastWriteError) {
    lastErrorRow.style.display = '';
    lastErrorEl.textContent = data.lastWriteError;
  } else {
    lastErrorRow.style.display = 'none';
  }

  try {
    const res = await fetch(`${SERVER_URL}/status`, { headers: { 'Authorization': SERVER_AUTH } });
    const status = await res.json();
    statusBox.className = 'status ok';
    statusBox.textContent = `Server running -- last write ${fmtTime(status.tastyfx?.lastWriteTime)}`;
  } catch {
    statusBox.className = 'status warn';
    statusBox.textContent = 'Local server not reachable. Run "node server.js" (see server/ folder).';
  }

  lastWriteEl.textContent = fmtTime(data.lastWriteTime);
  intervalInput.value = data.captureIntervalMinutes ?? 20;

  if (data.latestSnapshot?.positions?.length) {
    positionsTable.style.display = '';
    noPositionsMsg.style.display = 'none';
    positionsBody.innerHTML = '';
    for (const p of data.latestSnapshot.positions) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.market}</td><td>${p.size}</td><td>${p.latest}</td><td>${p.profitLossUsd}</td>`;
      positionsBody.appendChild(tr);
    }
  } else {
    // Last scan found nothing (or hasn't run yet) -- say so explicitly
    // instead of just leaving a blank gap where the table would be, since
    // that reads as "the extension is doing nothing" rather than "the last
    // scan came up empty, here's why" (see Diagnostics below it).
    positionsTable.style.display = 'none';
    noPositionsMsg.style.display = '';
  }

  // content.js's captureSnapshot() now records lastScanDiagnostics/
  // lastScanTime on EVERY scan (automatic or "Write Now"), success or not
  // -- unlike latestSnapshot/lastWriteTime above, which only ever update on
  // a scan that actually found positions. This is what lets a failed scan
  // still show something concrete here instead of the popup just staying
  // silent.
  lastScanEl.textContent = fmtTime(data.lastScanTime);
  diagLog.textContent = data.lastScanDiagnostics ? JSON.stringify(data.lastScanDiagnostics, null, 2) : '';
}

forceCaptureBtn.addEventListener('click', async () => {
  forceCaptureBtn.textContent = 'Writing…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('deal.ig.com')) {
    forceCaptureBtn.textContent = 'Write Now';
    actionLog.textContent = 'Active tab is not deal.ig.com.';
    return;
  }
  try {
    // Broadcast to every frame, not just the top one. The Positions grid
    // now lives inside a src-less child frame (content.js's all_frames +
    // match_origin_as_fallback reach it for the automatic timer-driven
    // captures), but chrome.tabs.sendMessage with no explicit frameId only
    // ever reaches frameId 0 (the top frame) -- it does NOT broadcast to
    // all frames on its own. Left as a plain sendMessage, "Write Now"
    // would silently poke only the top frame, which can never find the
    // grid, so the button would look like it worked (no error thrown) while
    // never actually refreshing anything. Enumerate real frame ids instead.
    let frameIds = [0];
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      if (frames?.length) frameIds = frames.map((f) => f.frameId);
    } catch {
      // getAllFrames itself failing (permission not yet granted after an
      // extension update, page mid-navigation, etc.) -- fall back to just
      // the top frame rather than not sending anything at all.
    }
    await Promise.allSettled(
      frameIds.map((frameId) =>
        chrome.tabs.sendMessage(tab.id, { type: 'FORCE_CAPTURE' }, { frameId })
      )
    );
    // Give the background script a moment to finish the POST to the server.
    await new Promise((r) => setTimeout(r, 800));
    await refreshStatus();
    actionLog.textContent = '';
  } catch (err) {
    actionLog.textContent = `Could not reach content script: ${err.message}`;
  }
  forceCaptureBtn.textContent = 'Write Now';
});

saveIntervalBtn.addEventListener('click', async () => {
  const minutes = Math.max(1, parseInt(intervalInput.value, 10) || 5);
  intervalInput.value = minutes;
  await chrome.storage.local.set({ captureIntervalMinutes: minutes });
  saveIntervalBtn.textContent = 'Saved';
  setTimeout(() => (saveIntervalBtn.textContent = 'Save'), 1000);
});

refreshStatus();
