/* global chrome */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { captureRequest, matchingSource, sourceIdentity, sourceUrl, studioOrigin } from '../browser-extension/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, '.data', 'source-capture', 'extension');
const executablePath = path.join(root, '.data', 'source-capture', 'browsers', 'chromium-1248', 'chrome-win64', 'chrome.exe');
assert.equal(studioOrigin('http://127.0.0.1:3000/studio'), 'http://127.0.0.1:3000');
assert.equal(studioOrigin('http://127.0.0.1:4000/studio'), null);
assert.equal(sourceIdentity('https://www.facebook.com/permalink.php?story_fbid=abc&id=owner'), 'facebook:post:abc');
assert.equal(sourceUrl('https://www.threads.com/@test/post/ABC?tracking=yes'), 'https://www.threads.com/@test/post/ABC');
assert.throws(() => sourceUrl('https://facebook.com.evil.org/a/posts/abc'));
assert.throws(() => captureRequest({ jobId: '../../private', requestId: randomUUID(), url: 'https://www.facebook.com/a/posts/abc' }));
assert(!matchingSource({ url: 'https://www.facebook.com/share/p/share/', resolvedIdentity: null }, 'https://www.facebook.com/a/posts/abc'));
assert(matchingSource({ url: 'https://www.facebook.com/share/p/share/', resolvedIdentity: 'facebook:post:abc' }, 'https://www.facebook.com/a/posts/abc'));
assert(!matchingSource({ url: 'https://www.facebook.com/share/p/share/', resolvedIdentity: 'facebook:post:abc' }, 'https://www.facebook.com/a/posts/other'));

const profile = await mkdtemp(path.join(os.tmpdir(), 'sf-extension-owned-test-'));
const context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, viewport: null, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const destination = path.join(root, 'test-results', 'current-browser-extension');
await mkdir(destination, { recursive: true });
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const url = 'https://www.facebook.com/owned-fixture/posts/extension';
  const shareUrl = 'https://www.facebook.com/share/p/owned-extension/';
  const html = '<!doctype html><meta charset="utf-8"><style>body{background:#ddd;font:20px Arial;margin:50px}article{background:white;width:650px;margin:20px;padding:16px;box-sizing:border-box}h3{font:700 20px Arial;margin:0;display:flex;gap:12px;align-items:center}h3 img{width:40px;height:40px;background:#315bda}p{line-height:1.5}.reacts{padding:12px;background:#e9eefb;color:#203a72}</style><article role="article"><h3><img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\'%3E%3Crect width=\'40\' height=\'40\' fill=\'%23315bda\'/%3E%3C/svg%3E"><a>Chủ bài thử</a></h3><p data-ad-preview="message">Đây là bài viết tổng hợp do dự án tạo để thử extension chụp ảnh nguồn.</p><div class="reacts">👍 123 · DỮ LIỆU THỬ</div>' + [10, 90, 50, 70, 30].map((reacts, index) => `<article role="article" aria-label="Bình luận của Bạn đọc ${index + 1}"><h3><a role="link"><span dir="auto">Bạn đọc ${index + 1}</span></a></h3><p dir="auto">Bình luận thử số ${index + 1} về hoạt động đọc sách cùng hàng xóm.</p><div class="reacts" aria-label="${reacts} cảm xúc">👍 ${reacts}</div></article>`).join('') + '</article>';
  let externalRequests = 0; const unexpectedUrls = [];
  await context.route('**/*', route => {
    const target = route.request().url();
    if (target === 'http://127.0.0.1:3000/extension-owned-fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Owned local Studio bridge test</title>' });
    if (target.startsWith('http://127.0.0.1:3000/studio?')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Studio recovery fixture</title>' });
    if (target === url) return route.fulfill({ contentType: 'text/html', body: html });
    if (target === shareUrl) return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(url)})</script>` });
    if (target === 'https://www.facebook.com/owned-fixture/posts/other') return route.fulfill({ contentType: 'text/html', body: html });
    if (target.startsWith('http:') || target.startsWith('https:')) { externalRequests++; unexpectedUrls.push(target); return route.abort(); }
    return route.continue();
  });
  const unbound = await context.newPage(); await unbound.goto(url);
  const missingPopup = await context.newPage(); await missingPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await unbound.bringToFront();
  const missing = await missingPopup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }));
  assert.equal(missing.ready, false); assert.equal(missing.reason, 'NO_REQUEST'); assert.equal(missing.recovery, 'OPEN_STUDIO');
  await missingPopup.locator('#confirm').check();
  await missingPopup.waitForFunction(() => document.querySelector('#recover').hidden === false);
  assert.equal(await missingPopup.locator('#capture').isDisabled(), true, 'Confirmation alone cannot create a capture request');
  await missingPopup.screenshot({ path: path.join(destination, 'popup-no-request.png'), clip: { x: 0, y: 0, width: 400, height: 600 } });
  await unbound.bringToFront();
  const recovered = context.waitForEvent('page');
  assert.equal((await missingPopup.evaluate(() => chrome.runtime.sendMessage({ type: 'OPEN_STUDIO' }))).ok, true);
  const recoveredStudio = await recovered;
  await recoveredStudio.waitForURL(value => value.pathname === '/studio');
  assert.equal(new URL(recoveredStudio.url()).searchParams.get('captureUrl'), url);
  assert.equal(new URL(recoveredStudio.url()).searchParams.get('mode'), 'import');
  assert.equal((await worker.evaluate(() => chrome.storage.session.get('pendingCapture'))).pendingCapture, undefined, 'Opening Studio must not silently start capture');
  await recoveredStudio.close(); await missingPopup.close(); await unbound.close();
  const studio = await context.newPage(); await studio.goto('http://127.0.0.1:3000/extension-owned-fixture');
  const requestId = randomUUID(), jobId = randomUUID();
  await studio.evaluate(() => {
    window.captureMessages = [];
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'shorts-factory-extension') return;
      window.captureMessages.push(event.data);
      if (event.data.type === 'PREPARED') Object.assign(document.body.dataset, { captureJob: event.data.jobId, captureRequest: event.data.requestId, captureStatus: 'WAITING_BROWSER' });
      if (['CAPTURE_IMAGE', 'CAPTURE_RESULT'].includes(event.data.type)) window.postMessage({ source: 'shorts-factory', type: 'CAPTURE_ACK', requestId: event.data.requestId, jobId: event.data.jobId, imageId: event.data.imageId, ok: true }, location.origin);
    });
  });
  const sourceCreated = context.waitForEvent('page');
  await studio.evaluate(({ requestId, jobId, url }) => window.postMessage({ source: 'shorts-factory', type: 'PREPARE_CAPTURE', requestId, jobId, url }, location.origin), { requestId, jobId, url });
  await studio.waitForFunction(() => window.captureMessages.some(message => message.type === 'PREPARED'));
  const sourcePage = await sourceCreated;
  assert(sourcePage, 'PREPARE must open an actual tab in this same browser context');
  await sourcePage.waitForURL(url); await sourcePage.bringToFront();
  const pageCount = context.pages().length;
  await studio.evaluate(({ requestId, jobId, url }) => window.postMessage({ source: 'shorts-factory', type: 'PREPARE_CAPTURE', requestId, jobId, url }, location.origin), { requestId, jobId, url });
  await studio.waitForFunction(() => window.captureMessages.filter(message => message.type === 'PREPARED').length === 2);
  assert.equal(context.pages().length, pageCount, 'Replay must reuse the exact source tab');
  await worker.evaluate(async () => { await chrome.action.openPopup(); });
  console.log(JSON.stringify({ extensionLoaded: true, sourceTabOpened: true, pages: context.pages().map(page => page.url()), extensionId }));
  const popup = context.pages().find(page => page.url() === `chrome-extension://${extensionId}/popup.html`) ?? await context.newPage();
  if (!popup.url().endsWith('/popup.html')) await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await sourcePage.bringToFront();
  const current = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }));
  if (!current.ready) console.log(JSON.stringify(await worker.evaluate(async () => ({ pending: (await chrome.storage.session.get('pendingCapture')).pendingCapture, tabs: await chrome.tabs.query({ active: true, currentWindow: true }) }))));
  assert.equal(current.ready, true, JSON.stringify(current));
  const viewport = await sourcePage.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollY }));
  const started = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'START_CAPTURE', confirmed: true }));
  assert.equal(started.ok, true, JSON.stringify(started));
  await studio.waitForFunction(() => window.captureMessages.some(message => ['CAPTURE_RESULT', 'CAPTURE_ERROR'].includes(message.type)), undefined, { timeout: 120000 });
  const messages = await studio.evaluate(() => window.captureMessages);
  const failed = messages.find(message => message.type === 'CAPTURE_ERROR');
  assert.equal(failed, undefined, JSON.stringify(failed));
  const result = messages.find(message => message.type === 'CAPTURE_RESULT');
  assert(result?.post.source_image_id, 'A real captured post PNG is required');
  assert.equal(result.post.comments.length, 5);
  assert.deepEqual(result.post.comments.map(comment => comment.reaction_count), [90, 70, 50, 30, 10]);
  const images = messages.filter(message => message.type === 'CAPTURE_IMAGE');
  assert.equal(images.length, 12);
  for (const image of images) {
    const bytes = Buffer.from(image.pngBase64, 'base64');
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    await writeFile(path.join(destination, `${image.imageId}.png`), bytes);
  }
  await writeFile(path.join(destination, 'capture.json'), JSON.stringify(result.post, null, 2));
  await sourcePage.waitForFunction(({ width, height, scrollY: y }) => innerWidth === width && innerHeight === height && scrollY === y, viewport);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }))).busy) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const sourceTab = await worker.evaluate(() => chrome.storage.session.get('pendingCapture'));
  const detached = await worker.evaluate(async tabId => { try { await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' }); return false; } catch { return true; } }, sourceTab.pendingCapture.sourceTabId);
  assert(detached, 'This extension must detach its debugger after sending images');
  const shareRequestId = randomUUID(), shareJobId = randomUUID();
  const shareCreated = context.waitForEvent('page');
  await studio.evaluate(({ requestId, jobId, url }) => window.postMessage({ source: 'shorts-factory', type: 'PREPARE_CAPTURE', requestId, jobId, url }, location.origin), { requestId: shareRequestId, jobId: shareJobId, url: shareUrl });
  const sharePage = await shareCreated;
  await sharePage.waitForURL(url);
  let shareState;
  for (let attempt = 0; attempt < 30; attempt++) {
    shareState = await worker.evaluate(() => chrome.storage.session.get('pendingCapture'));
    if (shareState.pendingCapture.resolvedIdentity) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(shareState.pendingCapture.resolvedIdentity, sourceIdentity(url), 'Only the original share redirect chain may resolve the post');
  await sharePage.goto('https://www.facebook.com/owned-fixture/posts/other');
  const wrongTabStatus = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }));
  assert.equal(wrongTabStatus.ready, false, 'Navigating to another source must invalidate capture');
  assert.equal(wrongTabStatus.recovery, 'OPEN_SOURCE');
  const beforeRecovery = context.pages().length;
  assert.equal((await popup.evaluate(({ requestId, jobId }) => chrome.runtime.sendMessage({ type: 'OPEN_SOURCE', requestId, jobId }), { requestId: shareRequestId, jobId: shareJobId })).ok, true);
  await sharePage.waitForURL(url);
  await sharePage.bringToFront();
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }))).ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }))).ready, true, 'Explicit recovery reopens only the bound source and verifies the redirect again');
  assert.equal(context.pages().length, beforeRecovery);
  await studio.evaluate(() => { delete document.body.dataset.captureJob; });
  const staleStudio = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }));
  assert.equal(staleStudio.reason, 'STUDIO_UNAVAILABLE'); assert.equal(staleStudio.ready, false);
  assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'START_CAPTURE', confirmed: true }))).ok, false);
  const resumeCreated = context.waitForEvent('page');
  assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'OPEN_STUDIO' }))).ok, true);
  const resumeStudio = await resumeCreated; await resumeStudio.waitForURL(value => value.pathname === '/studio');
  const resumeParams = new URL(resumeStudio.url()).searchParams;
  assert.equal(resumeParams.get('captureJob'), shareJobId); assert.equal(resumeParams.get('captureRequest'), shareRequestId);
  assert.equal(resumeParams.get('captureUrl'), shareUrl);
  await resumeStudio.evaluate(() => {
    window.addEventListener('message', event => {
      if (event.source === window && event.origin === location.origin && event.data?.source === 'shorts-factory-extension' && event.data.type === 'PREPARED') Object.assign(document.body.dataset, { captureJob: event.data.jobId, captureRequest: event.data.requestId, captureStatus: 'WAITING_BROWSER' });
    });
  });
  const beforeResume = context.pages().length;
  await resumeStudio.evaluate(({ requestId, jobId, url }) => window.postMessage({ source: 'shorts-factory', type: 'PREPARE_CAPTURE', requestId, jobId, url }, location.origin), { requestId: shareRequestId, jobId: shareJobId, url: shareUrl });
  await resumeStudio.waitForFunction(jobId => document.body.dataset.captureJob === jobId, shareJobId);
  await sharePage.bringToFront();
  assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }))).ready, true, 'A replacement Studio reconnects the existing job and source tab');
  assert.equal(context.pages().length, beforeResume, 'Resuming must reuse the already expanded source tab');
  await resumeStudio.close();
  const cancelRequestId = randomUUID(), cancelJobId = randomUUID();
  const cancelCreated = context.waitForEvent('page');
  await studio.evaluate(({ requestId, jobId, url }) => window.postMessage({ source: 'shorts-factory', type: 'PREPARE_CAPTURE', requestId, jobId, url }, location.origin), { requestId: cancelRequestId, jobId: cancelJobId, url });
  const cancelPage = await cancelCreated; await cancelPage.waitForURL(url); await cancelPage.bringToFront();
  assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CANCEL_FROM_POPUP' }))).ok, true);
  await studio.waitForFunction(jobId => window.captureMessages.some(message => message.type === 'CAPTURE_CANCELLED' && message.jobId === jobId), cancelJobId);
  assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }))).ready, false, 'A cancelled request cannot be restarted from the popup');
  assert.equal(externalRequests, 0, JSON.stringify(unexpectedUrls));
  const evidence = { status: 'PASS', sameBrowserTab: true, realExtensionLoaded: true, source: 'owned_synthetic_DOM', post: 1, comments: 5, images: 12, reactionsSorted: true, restoredViewport: true, debuggerDetached: true, replayReusesTab: true, shareRedirectBound: true, wrongPostBlocked: true, popupCancelNotifiesStudio: true, cancelledRequestBlocked: true, missingRequestExplained: true, studioRecoveryPrefillsOnly: true, exactTabRecovery: true, staleStudioBlocked: true, staleStudioResumesExistingJob: true, externalRequests };
  await writeFile(path.join(destination, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await context.close(); }
