// Service worker: relays captured rows from content.js to the shared local
// server (ext-server/server.js, also used by tastyfx and RebelsFunding).

const SERVER_URL = 'https://moreleadnow.com/api/ext';
// Fill in after generating the Caddy Basic Auth password on the server
// (see deploy/README.md, step 6) -- keep this repo private, this is the
// only thing standing between the internet and your account balances.
const SERVER_AUTH = 'Basic ' + btoa('tuan:ngvM4rSEHBYZTXkS5R9b');

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
          headers: { 'Content-Type': 'application/json', 'Authorization': SERVER_AUTH },
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
