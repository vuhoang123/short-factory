import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureAvailability, captureLifetimeMs } from '../browser-extension/protocol.js';

const url = 'https://www.facebook.com/owned-fixture/posts/test';
const request = { url, createdAt: 1000, sourceTabId: 12 };
const context = { tabId: 12, url, studioAvailable: true, now: 2000 };

test('an installed extension without a Studio request explains why capture is disabled', () => {
  assert.deepEqual(captureAvailability(undefined, context), { ready: false, reason: 'NO_REQUEST' });
});
test('a request needs its live Studio page and exact source tab before capture', () => {
  assert.deepEqual(captureAvailability(request, context), { ready: true, reason: 'READY' });
  assert.equal(captureAvailability(request, { ...context, studioAvailable: false }).reason, 'STUDIO_UNAVAILABLE');
  assert.equal(captureAvailability(request, { ...context, tabId: 14 }).reason, 'WRONG_TAB');
  assert.equal(captureAvailability(request, { ...context, url: 'https://www.facebook.com/owned-fixture/posts/other' }).ready, false);
});
test('expired and terminal requests cannot be recovered into an active capture', () => {
  assert.equal(captureAvailability(request, { ...context, now: 1000 + captureLifetimeMs }).reason, 'EXPIRED');
  assert.equal(captureAvailability({ ...request, cancelled: true }, context).reason, 'CANCELLED');
  assert.equal(captureAvailability({ ...request, completed: true }, context).reason, 'COMPLETED');
});
test('a share link still requires its verified redirect and rejects unrelated navigation', () => {
  const share = { ...request, url: 'https://www.facebook.com/share/p/owned/' };
  assert.equal(captureAvailability(share, context).reason, 'SOURCE_UNVERIFIED');
  assert.equal(captureAvailability({ ...share, resolvedIdentity: 'facebook:post:test' }, context).ready, true);
  assert.equal(captureAvailability({ ...share, resolvedIdentity: 'facebook:post:test', navigationMismatch: true }, context).reason, 'SOURCE_CHANGED');
});
