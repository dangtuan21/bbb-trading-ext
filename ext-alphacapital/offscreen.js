// Offscreen document: the only context with a full window/Worker-capable
// environment, so it's where Tesseract.js (loaded via vendor/tesseract.min.js,
// a local copy -- MV3 forbids loading it from a CDN at runtime) actually runs.
// corePath points at a local directory of vendored WASM core variants (SIMD /
// relaxed-SIMD / plain, all LSTM) rather than one specific file, per
// tesseract.js's own docs: this lets its internal feature-detection pick the
// right one instead of assuming which one a given Chrome build supports.

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      corePath: chrome.runtime.getURL('vendor/core'),
      workerPath: chrome.runtime.getURL('vendor/worker.min.js'),
      // Tesseract.js defaults to fetching the worker script and wrapping it
      // in a Blob (URL.createObjectURL) to sidestep cross-origin worker
      // restrictions -- but that blob-origin worker's own importScripts()
      // calls don't reliably resolve chrome-extension:// URLs, which is
      // exactly the "importScripts ... failed to load" error hit live.
      // Setting this to false loads the worker script directly instead.
      workerBlobURL: false,
    });
  }
  return workerPromise;
}

// Crops the full-tab screenshot to `rect` (already in device pixels) and
// upscales 2x in the same draw call -- matches the Python scraper's
// crop-then-upscale approach, which was needed there because a full-viewport
// OCR pass was dominated by unrelated on-screen text.
async function cropAndUpscale(dataUrl, rect) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(rect.width * 2, rect.height * 2);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width * 2, rect.height * 2);
  return canvas.convertToBlob({ type: 'image/png' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'OCR_REQUEST') return false;
  (async () => {
    try {
      const image = message.rect ? await cropAndUpscale(message.dataUrl, message.rect) : message.dataUrl;
      const worker = await getWorker();
      const { data } = await worker.recognize(image);
      sendResponse({ ok: true, text: data.text });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  return true;
});
