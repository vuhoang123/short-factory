/* global chrome */
(() => {
  if (window !== window.top || !['http://127.0.0.1:3000', 'http://localhost:3000'].includes(location.origin)) return;
  const origin = location.origin;
  const waiting = new Map();
  const emit = value => window.postMessage({ source: 'shorts-factory-extension', ...value }, origin);
  const key = message => `${message.requestId}:${message.jobId}:${message.imageId ?? 'result'}`;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== origin || event.data?.source !== 'shorts-factory') return;
    const message = event.data;
    if (message.type === 'PING') {
      try { chrome.runtime.sendMessage({ type: 'BRIDGE_PING' }, result => {
        if (!chrome.runtime.lastError && result?.ok) emit({ type: 'PONG', requestId: message.requestId, version: result.version });
      }); } catch { /* A reloaded extension needs a fresh Studio tab. */ }
      return;
    }
    if (message.type === 'CAPTURE_ACK') {
      const callback = waiting.get(key(message));
      if (callback) { waiting.delete(key(message)); callback({ ok: message.ok === true, error: typeof message.error === 'string' ? message.error.slice(0, 200) : undefined }); }
      return;
    }
    if (!['PREPARE_CAPTURE', 'CANCEL_CAPTURE'].includes(message.type)) return;
    chrome.runtime.sendMessage({ type: message.type, requestId: message.requestId, jobId: message.jobId, url: message.url }, result => {
      if (chrome.runtime.lastError || !result?.ok) emit({ type: 'CAPTURE_ERROR', requestId: message.requestId, jobId: message.jobId, error: result?.error ?? 'CAPTURE_EXTENSION_UNAVAILABLE' });
      else emit({ type: message.type === 'PREPARE_CAPTURE' ? 'PREPARED' : 'CANCELLED', requestId: message.requestId, jobId: message.jobId, sourceTabId: result.sourceTabId });
    });
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.source === 'shorts-factory-extension' && message.type === 'CAPTURE_CONTEXT') {
      const element = document.querySelector('[data-capture-job]');
      respond({ ok: element?.dataset.captureJob === message.jobId && element?.dataset.captureRequest === message.requestId && element?.dataset.captureStatus === 'WAITING_BROWSER' });
      return;
    }
    if (message?.source !== 'shorts-factory-extension' || !['CAPTURE_IMAGE', 'CAPTURE_RESULT', 'CAPTURE_ERROR', 'CAPTURE_CANCELLED'].includes(message.type)) return;
    if (message.type === 'CAPTURE_ERROR' || message.type === 'CAPTURE_CANCELLED') { emit(message); respond({ ok: true }); return; }
    const id = key(message);
    const timer = setTimeout(() => { waiting.delete(id); respond({ ok: false, error: 'CAPTURE_STUDIO_ACK_TIMEOUT' }); }, 60_000);
    waiting.set(id, result => { clearTimeout(timer); respond(result); });
    emit(message);
    return true;
  });
})();
