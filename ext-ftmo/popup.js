const SERVER_URL = 'https://trading.moreleadnow.com/api/ext';
// Fill in after generating the Caddy Basic Auth password on the server
// (see deploy/README.md, step 6) -- keep this repo private, this is the
// only thing standing between the internet and your account balances.
const SERVER_AUTH = 'Basic ' + btoa('tuan:REPLACE_WITH_PASSWORD');

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

function fmtTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString();
}

async function refreshStatus() {
  const data = await chrome.storage.local.get([
    'latestRows', 'lastWriteTime', 'captureIntervalMinutes', 'lastWriteError', 'lastCaptureDiag',
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
    statusBox.textContent = `Server running -- last write ${fmtTime(status.ftmo?.lastWriteTime)}`;
  } catch {
    statusBox.className = 'status warn';
    statusBox.textContent = 'Local server not reachable. Run "node server.js" (see ext-server/ folder).';
  }

  lastWriteEl.textContent = fmtTime(data.lastWriteTime);
  intervalInput.value = data.captureIntervalMinutes ?? 20;

  if (data.latestRows?.length) {
    positionsTable.style.display = '';
    positionsBody.innerHTML = '';
    for (const r of data.latestRows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.Symbol}</td><td>${r.Direction}</td><td>${r.Size}</td><td>${r.PositionPL}</td>`;
      positionsBody.appendChild(tr);
    }
  }

  actionLog.textContent = data.lastCaptureDiag ? JSON.stringify(data.lastCaptureDiag, null, 2) : '';
}

forceCaptureBtn.addEventListener('click', async () => {
  forceCaptureBtn.textContent = 'Writing…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('trader.ftmo.oanda.com')) {
    forceCaptureBtn.textContent = 'Write Now';
    actionLog.textContent = 'Active tab is not trader.ftmo.oanda.com.';
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'FORCE_CAPTURE' });
    await new Promise((r) => setTimeout(r, 800));
    await refreshStatus();
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
