import { describe, expect, it, vi, afterEach } from 'vitest';
import { captureUrlSchema, localCaptureCall } from './local-capture.js';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('dedicated local capture boundary', () => {
  it('accepts post links and preserves Facebook PHP identity but rejects navigation and arbitrary hosts', () => {
    expect(captureUrlSchema.parse('https://www.facebook.com/permalink.php?story_fbid=post&id=author')).toContain('story_fbid=post');
    expect(captureUrlSchema.parse('https://www.threads.com/@demo/post/ABC?tracking=1')).toBe('https://www.threads.com/@demo/post/ABC');
    for (const value of ['http://facebook.com/a/posts/1', 'https://facebook.com.evil.org/a/posts/1', 'https://127.0.0.1/a/posts/1', 'https://facebook.com/', 'https://u:p@facebook.com/a/posts/1', 'https://threads.com/@demo', 'https://facebook.com:3003/a/posts/1']) expect(captureUrlSchema.safeParse(value).success).toBe(false);
  });
  it('fails closed in production, without opt-in, and for non-loopback service endpoints', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('LOCAL_CAPTURE_ENABLED', '1');
    await expect(localCaptureCall('open', {})).rejects.toThrow('LOCAL_CAPTURE_DISABLED');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('LOCAL_CAPTURE_URL', 'http://example.org:3003'); vi.stubEnv('LOCAL_CAPTURE_TOKEN', 'a'.repeat(64));
    await expect(localCaptureCall('open', {})).rejects.toThrow('LOCAL_CAPTURE_CONFIG_INVALID'); expect(fetch).not.toHaveBeenCalled();
  });
});
