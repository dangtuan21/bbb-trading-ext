// Service worker: records the latest snapshot for the popup, and POSTs it to
// the shared local Node server (ext-server/server.js, also used by the
// RebelsFunding extension) which does the actual file write. A plain
// fetch() from the service worker works with no user gesture and no tab
// needing to stay open, unlike the File System Access API.

const SERVER_URL = 'https://moreleadnow.com/api/ext';
// Fill in after generating the Caddy Basic Auth password on the server
// (see deploy/README.md, step 6) -- keep this repo private, this is the
// only thing standing between the internet and your account balances.
const SERVER_AUTH = 'Basic ' + btoa('tuan:ngvM4rSEHBYZTXkS5R9b');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SNAPSHOT') {
    (async () => {
      await chrome.storage.local.set({ latestSnapshot: message.snapshot });

      try {
        const accountId = message.snapshot.identity?.accountId || 'n/a';
        const accountLabel = message.snapshot.identity?.accountLabel || 'n/a';
        const res = await fetch(`${SERVER_URL}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': SERVER_AUTH },
          body: JSON.stringify({ platform: 'tastyfx', snapshot: message.snapshot, accountId, accountLabel })
        });
        const result = await res.json();
        if (result.ok) {
          await chrome.storage.local.set({
            lastWriteTime: new Date().toISOString(),
            lastWriteError: null
          });
        } else {
          await chrome.storage.local.set({ lastWriteError: result.error || 'server rejected snapshot' });
        }
      } catch (err) {
        // Most commonly: server isn't running.
        await chrome.storage.local.set({ lastWriteError: `Could not reach local server: ${err.message}` });
      }

      sendResponse({ ok: true });
    })();
    return true;
  }
});
