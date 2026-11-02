import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { browserCaptureMessageSchema, browserCaptureUrlSchema, decodeCapturePng, pendingBrowserCaptureSchema } from './browser-capture';

describe('current-browser capture bridge', () => {
  it('opens only explicit HTTPS Facebook/Threads post URLs and preserves PHP identity', () => {
    expect(browserCaptureUrlSchema.parse('https://www.facebook.com/share/p/owned/?tracking=1#x')).toBe('https://www.facebook.com/share/p/owned/');
    expect(browserCaptureUrlSchema.parse('https://www.facebook.com/permalink.php?story_fbid=post&id=owner')).toContain('story_fbid=post');
    for (const url of ['javascript:alert(1)', 'https://facebook.com.evil.org/a/posts/1', 'https://facebook.com/', 'https://u:p@facebook.com/a/posts/1', 'http://threads.com/@a/post/1']) expect(browserCaptureUrlSchema.safeParse(url).success).toBe(false);
  });
  it('requires the extension source and UUID identities and stores only resumable request metadata', () => {
    const pending = { id: randomUUID(), requestId: randomUUID(), url: 'https://www.threads.com/@demo/post/owned', browser: 'CURRENT' };
    expect(pendingBrowserCaptureSchema.parse(pending)).toEqual(pending);
    expect(pendingBrowserCaptureSchema.safeParse({ ...pending, text: 'private source text' }).success).toBe(false);
    expect(browserCaptureMessageSchema.safeParse({ source: 'shorts-factory-extension', type: 'PREPARED', requestId: pending.requestId, jobId: pending.id }).success).toBe(true);
    expect(browserCaptureMessageSchema.safeParse({ source: 'another-extension', type: 'PREPARED', requestId: pending.requestId, jobId: pending.id }).success).toBe(false);
  });
  it('rejects non-PNG, invalid and oversized encoded images before upload', () => {
    expect([...decodeCapturePng(btoa('\x89PNG\r\n\x1a\n'))]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(() => decodeCapturePng(btoa('not a PNG'))).toThrow();
    expect(() => decodeCapturePng('invalid!base64')).toThrow();
    expect(() => decodeCapturePng('A'.repeat(28_000_001))).toThrow();
  });
});
