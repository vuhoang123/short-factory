/* global chrome */
import { captureAvailability, captureLifetimeMs, captureRequest, sourceUrl, sourceIdentity, matchingSource, safeError, studioOrigin } from './protocol.js';
import { readSource, sourceGeometry } from './engine.js';

let current;
let status = 'Chưa có bài chờ chụp. Mở Studio và chọn bài trước.';
let running = false;
let cancelled = false;
const expires = captureLifetimeMs;
const maximumImage = 20 * 1024 * 1024;
const validPending = pending => pending && Date.now() - pending.createdAt < expires;
async function pending() {
  current ??= (await chrome.storage.session.get('pendingCapture')).pendingCapture;
  return validPending(current) ? current : undefined;
}
async function studioAvailable(request) {
  if (!request) return false;
  try {
    const tab = await chrome.tabs.get(request.studioTabId);
    if (studioOrigin(tab.url) !== request.origin) return false;
    const response = await chrome.tabs.sendMessage(request.studioTabId, { source: 'shorts-factory-extension', type: 'CAPTURE_CONTEXT', requestId: request.requestId, jobId: request.jobId });
    return response?.ok === true;
  } catch { return false; }
}
async function save(value) { current = value; await chrome.storage.session.set({ pendingCapture: value }); }
const check = () => { if (cancelled) throw new Error('CAPTURE_CANCELLED'); };
async function frameUrl(tabId, known) {
  if (typeof known === 'string') return known;
  return (await chrome.webNavigation.getFrame({ tabId, frameId: 0 }))?.url;
}
async function command(tabId, method, params = {}) {
  check(); return chrome.debugger.sendCommand({ tabId }, method, params);
}
async function evaluate(tabId, func, args) {
  const expression = `(${func.toString()})(${JSON.stringify(args)})`;
  const result = await command(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('CAPTURE_SOURCE_SCRIPT_FAILED');
  return result.result?.value;
}
async function deliver(request, message) {
  check();
  const tab = await chrome.tabs.get(request.studioTabId);
  if (studioOrigin(tab.url) !== request.origin) throw new Error('CAPTURE_STUDIO_TAB_CHANGED');
  const result = await chrome.tabs.sendMessage(request.studioTabId, { source: 'shorts-factory-extension', requestId: request.requestId, jobId: request.jobId, ...message });
  if (result?.ok !== true) throw new Error(result?.error && /^[A-Z][A-Z0-9_]{1,79}$/.test(result.error) ? result.error : 'CAPTURE_STUDIO_REJECTED');
}
function imageId() { return crypto.randomUUID().replaceAll('-', ''); }
function bytesOf(base64) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(maximumImage * 4 / 3) + 8) throw new Error('CAPTURE_IMAGE_TOO_LARGE');
  const raw = atob(base64);
  if (raw.length > maximumImage) throw new Error('CAPTURE_IMAGE_TOO_LARGE');
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
async function maskImage(base64, geometry) {
  if (!geometry.has_name || !geometry.masks?.length) return null;
  const bitmap = await createImageBitmap(new Blob([bytesOf(base64)], { type: 'image/png' }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('CAPTURE_IMAGE_MASK_FAILED');
    context.drawImage(bitmap, 0, 0); context.fillStyle = '#767680';
    const sx = bitmap.width / geometry.width, sy = bitmap.height / geometry.height;
    for (const box of geometry.masks) {
      const x = Math.max(0, Math.floor(box.x * sx) - 2), y = Math.max(0, Math.floor(box.y * sy) - 2);
      const right = Math.min(bitmap.width, Math.ceil((box.x + box.width) * sx) + 2), bottom = Math.min(bitmap.height, Math.ceil((box.y + box.height) * sy) + 2);
      if (right > x && bottom > y) context.fillRect(x, y, right - x, bottom - y);
    }
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    if (bytes.byteLength > maximumImage) throw new Error('CAPTURE_IMAGE_TOO_LARGE');
    let raw = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(raw);
  } finally { bitmap.close(); }
}
async function capture(request) {
  const tabId = request.sourceTabId;
  let attached = false;
  let original;
  const deadline = Date.now() + 15 * 60_000;
  let totalBytes = 0;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!matchingSource(request, await frameUrl(tabId, tab.url)) || request.navigationMismatch || request.cancelled) throw new Error('CAPTURE_WRONG_SOURCE_TAB');
    await chrome.debugger.attach({ tabId }, '1.3'); attached = true;
    original = await evaluate(tabId, () => ({ url: location.href, width: innerWidth, height: innerHeight, x: scrollX, y: scrollY, scale: devicePixelRatio }), null);
    if (!matchingSource(request, original.url)) throw new Error('CAPTURE_WRONG_SOURCE_TAB');
    await command(tabId, 'Emulation.setDeviceMetricsOverride', { width: original.width, height: 8000, deviceScaleFactor: original.scale, mobile: false });
    const context = { platform: sourceIdentity(request.url).startsWith('facebook:') ? 'facebook' : 'threads', postCode: sourceIdentity(request.url).startsWith('threads:') ? sourceIdentity(request.url).split(':').at(-1) : undefined };
    const parsed = await evaluate(tabId, readSource, context);
    if (!parsed?.post || parsed.error) throw new Error(parsed?.error ?? 'CAPTURE_POST_NOT_IDENTIFIED');
    const { post, entries } = parsed;
    post.url = request.url;
    status = `Đã nhận diện bài và ${post.comments.length} bình luận. Đang chụp ảnh gốc…`;
    for (const [index, entry] of entries.entries()) {
      check();
      if (Date.now() > deadline) throw new Error('CAPTURE_TIMEOUT');
      const prepared = await evaluate(tabId, async ({ key, expected, geometrySource }) => {
        const element = document.querySelector(`[data-hidro-source="${key}"]`);
        if (!element || !(element.innerText || '').includes(expected)) return { error: 'CAPTURE_SOURCE_CHANGED' };
        element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
        window.scrollBy(0, -40);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { x: scrollX, y: scrollY, url: location.href, key, geometrySource };
      }, { key: entry.key, expected: entry.text, geometrySource: null });
      if (prepared?.error || !matchingSource(request, prepared?.url)) throw new Error(prepared?.error ?? 'CAPTURE_SOURCE_CHANGED');
      const geometryResult = await command(tabId, 'Runtime.evaluate', { expression: `(${sourceGeometry.toString()})(document.querySelector('[data-hidro-source="${entry.key}"]'),${JSON.stringify(entry)})`, returnByValue: true });
      const box = geometryResult.result?.value;
      if (geometryResult.exceptionDetails || !box || box.error || box.width < 100 || box.height < 30 || box.height > 6000 || box.width * box.height > 20_000_000) {
        if (entry.main) throw new Error('CAPTURE_POST_IMAGE_UNAVAILABLE');
        post.warnings.push(`Bình luận ${index}: không chụp được trọn ảnh gốc (${box?.error ?? 'invalid_geometry'}).`);
        continue;
      }
      const screenshot = await command(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: box.x + prepared.x, y: box.y + prepared.y, width: box.width, height: box.height, scale: 1 } });
      const bytes = bytesOf(screenshot.data); totalBytes += bytes.length;
      if (totalBytes > 128 * 1024 * 1024) throw new Error('CAPTURE_TOTAL_SIZE_EXCEEDED');
      const target = entry.main ? post : post.comments.find(comment => comment.captureKey === entry.key);
      if (!target) throw new Error('CAPTURE_SOURCE_CHANGED');
      target.source_image_id = imageId();
      await deliver(request, { type: 'CAPTURE_IMAGE', imageId: target.source_image_id, pngBase64: screenshot.data });
      const masked = await maskImage(screenshot.data, box);
      if (masked) {
        totalBytes += bytesOf(masked).length;
        if (totalBytes > 128 * 1024 * 1024) throw new Error('CAPTURE_TOTAL_SIZE_EXCEEDED');
        target.anonymous_image_id = imageId();
        await deliver(request, { type: 'CAPTURE_IMAGE', imageId: target.anonymous_image_id, pngBase64: masked });
      }
      status = `Đã gửi ảnh ${index + 1}/${entries.length}. Giữ tab Studio mở.`;
    }
    const final = await evaluate(tabId, () => location.href, null);
    if (!matchingSource(request, final) || (await pending())?.navigationMismatch) throw new Error('CAPTURE_SOURCE_CHANGED');
    for (const comment of post.comments) delete comment.captureKey;
    await deliver(request, { type: 'CAPTURE_RESULT', post });
    status = 'Đã gửi ảnh và nội dung về Studio. Quay lại Studio để kiểm tra và duyệt quyền.';
    await save({ ...request, completed: true });
  } catch (error) {
    const code = safeError(error);
    status = code === 'CAPTURE_CANCELLED' ? 'Đã hủy lượt chụp.' : `Chụp chưa thành công: ${code}. Mở đúng bài, đóng DevTools nếu đang dùng, rồi thử lại.`;
    if (code === 'CAPTURE_CANCELLED') await save({ ...request, cancelled: true });
    await chrome.tabs.sendMessage(request.studioTabId, { source: 'shorts-factory-extension', type: code === 'CAPTURE_CANCELLED' ? 'CAPTURE_CANCELLED' : 'CAPTURE_ERROR', requestId: request.requestId, jobId: request.jobId, error: code }).catch(() => undefined);
  } finally {
    if (attached) {
      // Cleanup remains allowed after the user cancels; command() intentionally rejects new capture work.
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride').catch(() => undefined);
      if (original) await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: `window.scrollTo(${Number(original.x)},${Number(original.y)})` }).catch(() => undefined);
      await chrome.debugger.detach({ tabId }).catch(() => undefined);
    }
    running = false; cancelled = false;
  }
}

async function prepare(message, sender) {
  const origin = studioOrigin(sender.url);
  if (!origin || !sender.tab?.id || sender.frameId !== 0) throw new Error('CAPTURE_STUDIO_ORIGIN_INVALID');
  const input = captureRequest(message);
  const existing = await pending();
  if (existing?.jobId === input.jobId && existing.requestId === input.requestId && existing.url === input.url && existing.origin === origin && (existing.studioTabId === sender.tab.id || !running && !await studioAvailable(existing))) {
    const source = await chrome.tabs.get(existing.sourceTabId).catch(() => null);
    if (source) {
      if (existing.cancelled) throw new Error('CAPTURE_CANCELLED');
      const rebound = { ...existing, studioTabId: sender.tab.id };
      await save(rebound);
      if (!existing.resolvedIdentity && sourceIdentity(existing.url).includes(':share:')) {
        await save({ ...rebound, allowShareResolution: true });
        await chrome.tabs.update(source.id, { active: true, url: existing.url });
      } else await chrome.tabs.update(source.id, { active: true });
      return { ok: true, sourceTabId: source.id };
    }
  }
  if (running) throw new Error('CAPTURE_ALREADY_RUNNING');
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true, windowId: sender.tab.windowId });
  await save({ ...input, origin, studioTabId: sender.tab.id, sourceTabId: tab.id, createdAt: Date.now(), resolvedIdentity: null, allowShareResolution: true, navigationMismatch: false, completed: false, cancelled: false });
  status = 'Mở đầy đủ bài/bình luận trong tab vừa mở, rồi bấm biểu tượng extension để chụp.';
  await chrome.tabs.update(tab.id, { url: input.url });
  return { ok: true, sourceTabId: tab.id };
}
async function onMessage(message, sender) {
  if (message?.type === 'BRIDGE_PING') {
    if (!studioOrigin(sender.url) || !sender.tab?.id || sender.frameId !== 0) throw new Error('CAPTURE_STUDIO_ORIGIN_INVALID');
    return { ok: true, version: chrome.runtime.getManifest().version };
  }
  if (message?.type === 'PREPARE_CAPTURE') return prepare(message, sender);
  if (message?.type === 'CANCEL_CAPTURE') {
    const request = await pending();
    if (!request || studioOrigin(sender.url) !== request.origin || sender.tab?.id !== request.studioTabId || sender.frameId !== 0 || message.requestId !== request.requestId || message.jobId !== request.jobId) throw new Error('CAPTURE_REQUEST_INVALID');
    cancelled = true;
    await save({ ...request, cancelled: true });
    if (!running) status = 'Đã hủy lượt chụp.';
    return { ok: true };
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) throw new Error('CAPTURE_EXTENSION_SENDER_INVALID');
  const request = await pending();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeUrl = tab?.id ? await frameUrl(tab.id, tab.url) : undefined;
  const availability = captureAvailability(current, { tabId: tab?.id, url: activeUrl, studioAvailable: await studioAvailable(request), now: Date.now() });
  const ready = availability.ready;
  if (message?.type === 'CAPTURE_STATUS') {
    const descriptions = {
      NO_REQUEST: 'Chưa có lượt chụp từ Studio. Nếu vừa cài extension, tab Studio cũ cần tải lại. Mở Studio bằng nút dưới, rồi bấm “Mở bài trong trình duyệt hiện tại”.',
      EXPIRED: 'Lượt chụp đã hết 30 phút. Mở Studio và tạo lượt mới.',
      CANCELLED: 'Lượt chụp đã hủy. Mở Studio và tạo lượt mới.',
      COMPLETED: 'Đã gửi ảnh về Studio. Quay lại để kiểm tra và dựng video.',
      STUDIO_UNAVAILABLE: 'Tab Studio đang nhận ảnh đã đóng, đổi workspace hoặc không còn mở lượt này. Mở Studio để khôi phục lượt chụp.',
      WRONG_TAB: 'Bạn đang ở tab khác với tab được Studio mở. Bấm nút dưới để về đúng bài chờ chụp.',
      SOURCE_CHANGED: 'Tab đã chuyển sang bài khác. Mở lại bài đã chọn trước khi chụp.',
      SOURCE_UNVERIFIED: 'Chưa xác nhận được bài sau chuyển hướng hoặc đăng nhập. Bấm mở lại bài đã chọn; không cần đăng nhập lại nếu phiên đã còn hiệu lực.',
    };
    return { ok: true, ready, reason: availability.reason, busy: running, status: ready || running ? status : descriptions[availability.reason], url: current?.url, requestId: request?.requestId, jobId: request?.jobId,
      recovery: running || ready ? null : ['WRONG_TAB', 'SOURCE_CHANGED', 'SOURCE_UNVERIFIED'].includes(availability.reason) ? 'OPEN_SOURCE' : 'OPEN_STUDIO' };
  }
  if (message?.type === 'OPEN_STUDIO') {
    if (running) throw new Error('CAPTURE_ALREADY_RUNNING');
    if (request?.completed) {
      const studio = await chrome.tabs.get(request.studioTabId).catch(() => null);
      if (studio && studioOrigin(studio.url) === request.origin) { await chrome.tabs.update(studio.id, { active: true }); return { ok: true }; }
    }
    const studios = await chrome.tabs.query({ url: ['http://127.0.0.1:3000/*', 'http://localhost:3000/*'], currentWindow: true });
    const origin = request?.origin ?? studios.map(value => studioOrigin(value.url)).find(Boolean) ?? 'http://127.0.0.1:3000';
    const target = new URL('/studio?mode=import', origin);
    try { target.searchParams.set('captureUrl', sourceUrl(request?.url ?? activeUrl)); } catch { /* Studio still accepts a manually pasted link. */ }
    if (request && !request.cancelled && !request.completed) {
      target.searchParams.set('captureJob', request.jobId);
      target.searchParams.set('captureRequest', request.requestId);
    }
    const studio = await chrome.tabs.create({ url: 'about:blank', active: true });
    await chrome.tabs.update(studio.id, { url: target.toString() });
    return { ok: true };
  }
  if (message?.type === 'OPEN_SOURCE') {
    if (running || !request || request.cancelled || request.completed || request.requestId !== message.requestId || request.jobId !== message.jobId || !await studioAvailable(request)) throw new Error('CAPTURE_REQUEST_INVALID');
    const source = await chrome.tabs.get(request.sourceTabId).catch(() => null);
    const target = source ?? await chrome.tabs.create({ url: 'about:blank', active: true, windowId: tab?.windowId });
    await save({ ...request, sourceTabId: target.id, resolvedIdentity: null, navigationMismatch: false, allowShareResolution: true });
    status = 'Mở đầy đủ bài/bình luận trong tab này, rồi bấm extension để chụp.';
    await chrome.tabs.update(target.id, { url: request.url, active: true });
    return { ok: true };
  }
  if (message?.type === 'CANCEL_FROM_POPUP') {
    cancelled = true;
    if (request) {
      await save({ ...request, cancelled: true });
      if (!running) await chrome.tabs.sendMessage(request.studioTabId, { source: 'shorts-factory-extension', type: 'CAPTURE_CANCELLED', requestId: request.requestId, jobId: request.jobId }).catch(() => undefined);
    }
    return { ok: true };
  }
  if (message?.type === 'START_CAPTURE') {
    if (!ready || message.confirmed !== true) throw new Error('CAPTURE_CONFIRM_SOURCE_FIRST');
    if (running) throw new Error('CAPTURE_ALREADY_RUNNING');
    running = true; cancelled = false; status = 'Đang chụp. Không đóng tab nguồn hoặc Studio; có thể đóng popup này.';
    void capture(request); return { ok: true };
  }
  throw new Error('CAPTURE_EXTENSION_MESSAGE_INVALID');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void onMessage(message, sender).then(respond, error => respond({ ok: false, error: safeError(error) }));
  return true;
});
async function navigation(details) {
  if (details.frameId !== 0) return;
  const request = await pending();
  if (!request || request.sourceTabId !== details.tabId || request.completed) return;
  let identity;
  try { identity = sourceIdentity(details.url); } catch {
    if (details.url === 'about:blank') return;
    if (!request.resolvedIdentity && sourceIdentity(request.url).includes(':share:')) await save({ ...request, allowShareResolution: false });
    if (running) cancelled = true;
    return;
  }
  const expected = sourceIdentity(request.url);
  if (expected.includes(':share:') && identity.startsWith('facebook:post:') && !request.resolvedIdentity && request.allowShareResolution && details.transitionQualifiers?.some(value => ['server_redirect', 'client_redirect'].includes(value))) await save({ ...request, resolvedIdentity: identity });
  else if (!expected.includes(':share:') && expected !== identity || request.resolvedIdentity && request.resolvedIdentity !== identity) { await save({ ...request, navigationMismatch: true }); if (running) cancelled = true; }
}
chrome.webNavigation.onCommitted.addListener(details => { void navigation(details); });
chrome.webNavigation.onHistoryStateUpdated.addListener(details => { void navigation(details); });
