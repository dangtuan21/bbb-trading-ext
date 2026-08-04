// Service worker: relays captured rows from content.js to the shared local
// server (ext-server/server.js, also used by tastyfx and RebelsFunding).

const SERVER_URL = 'http://127.0.0.1:8765';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FTMO_ROWS') {
    (async () => {
      await chrome.storage.local.set({
        latestRows: message.rows,
        lastCaptureDiag: message.diag || null,
      });

      try {
        const res = await fetch(`${SERVER_URL}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: 'ftmo', rows: message.rows }),
        });
        const result = await res.json();
        if (result.ok) {
          await chrome.storage.local.set({ lastWriteTime: new Date().toISOString(), lastWriteError: null });
        } else {
          await chrome.storage.local.set({ lastWriteError: result.error || 'server rejected write' });
        }
      } catch (err) {
        await chrome.storage.local.set({ lastWriteError: `Could not reach local server: ${err.message}` });
      }

      sendResponse({ ok: true });
    })();
    return true;
  }
});
