// Service worker: records the latest snapshot for the popup, and POSTs it to
// the shared local Node server (ext-server/server.js, also used by the
// RebelsFunding extension) which does the actual file write. A plain
// fetch() from the service worker works with no user gesture and no tab
// needing to stay open, unlike the File System Access API.

const SERVER_URL = 'http://127.0.0.1:8765';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SNAPSHOT') {
    (async () => {
      await chrome.storage.local.set({ latestSnapshot: message.snapshot });

      try {
        const accountId = message.snapshot.identity?.accountId || 'n/a';
        const accountLabel = message.snapshot.identity?.accountLabel || 'n/a';
        const res = await fetch(`${SERVER_URL}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
