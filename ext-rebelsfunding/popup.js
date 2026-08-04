const statusBox = document.getElementById('statusBox');
const lastScanEl = document.getElementById('lastScan');
const accountCountEl = document.getElementById('accountCount');
const rowCountEl = document.getElementById('rowCount');
const runScanBtn = document.getElementById('runScanBtn');
const intervalInput = document.getElementById('intervalInput');
const saveIntervalBtn = document.getElementById('saveIntervalBtn');
const diagLog = document.getElementById('diagLog');

function fmtTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString();
}

async function refreshStatus() {
  const data = await chrome.storage.local.get([
    'scanStatus', 'lastScanError', 'lastScanTime', 'lastScanAccountCount',
    'lastScanRowCount', 'lastScanDiagnostics', 'scanIntervalMinutes',
  ]);

  if (data.scanStatus === 'running') {
    statusBox.className = 'status busy';
    statusBox.textContent = 'Scan running... (a dedicated browser window is doing the work)';
    runScanBtn.disabled = true;
    runScanBtn.textContent = 'Scanning...';
  } else {
    runScanBtn.disabled = false;
    runScanBtn.textContent = 'Run Full Scan Now';
    if (data.scanStatus === 'error') {
      statusBox.className = 'status warn';
      statusBox.textContent = data.lastScanError || 'Last scan failed.';
    } else if (data.scanStatus === 'done') {
      statusBox.className = 'status ok';
      statusBox.textContent = `Last scan OK -- ${data.lastScanAccountCount ?? 0} account(s), ${data.lastScanRowCount ?? 0} row(s)`;
    } else {
      statusBox.className = 'status warn';
      statusBox.textContent = 'No scan run yet.';
    }
  }

  lastScanEl.textContent = fmtTime(data.lastScanTime);
  accountCountEl.textContent = data.lastScanAccountCount ?? '–';
  rowCountEl.textContent = data.lastScanRowCount ?? '–';
  intervalInput.value = data.scanIntervalMinutes ?? 20;

  if (data.lastScanDiagnostics && data.lastScanDiagnostics.length) {
    diagLog.textContent = JSON.stringify(data.lastScanDiagnostics, null, 2);
  } else {
    diagLog.textContent = '';
  }
}

runScanBtn.addEventListener('click', async () => {
  runScanBtn.disabled = true;
  runScanBtn.textContent = 'Scanning...';
  statusBox.className = 'status busy';
  statusBox.textContent = 'Scan running... (a dedicated browser window is doing the work)';
  await chrome.runtime.sendMessage({ type: 'RUN_SCAN_NOW' });
  await refreshStatus();
});

saveIntervalBtn.addEventListener('click', async () => {
  const minutes = Math.max(0, parseInt(intervalInput.value, 10) || 0);
  intervalInput.value = minutes;
  await chrome.storage.local.set({ scanIntervalMinutes: minutes });
  saveIntervalBtn.textContent = 'Saved';
  setTimeout(() => (saveIntervalBtn.textContent = 'Save'), 1000);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') refreshStatus();
});

refreshStatus();
