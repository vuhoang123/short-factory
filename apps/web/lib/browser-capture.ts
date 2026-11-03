import { z } from 'zod';

const sourceHosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);
export const browserCaptureUrlSchema = z.string().trim().url().max(2048).superRefine((value, context) => {
  let url: URL;
  try { url = new URL(value); }
  catch { context.addIssue({ code: 'custom', message: 'Cần link bài Facebook hoặc Threads hợp lệ.' }); return; }
  const facebook = url.hostname.endsWith('facebook.com');
  if (url.protocol !== 'https:' || url.username || url.password || !sourceHosts.has(url.hostname) || (url.port && url.port !== '443') ||
    !(facebook ? /\/(posts|permalink|share\/p)\/[^/]+/.test(url.pathname) || /\/(story|permalink)\.php$/.test(url.pathname) && Boolean(url.searchParams.get('story_fbid') && url.searchParams.get('id')) : /^\/@[^/]+\/post\/[\w-]+/.test(url.pathname))) {
    context.addIssue({ code: 'custom', message: 'Cần link bài Facebook hoặc Threads cụ thể qua HTTPS.' });
  }
}).transform(value => { const url = new URL(value); url.hash = ''; if (!url.pathname.endsWith('.php')) url.search = ''; return url.toString(); });

export const pendingBrowserCaptureSchema = z.object({ id: z.string().uuid(), requestId: z.string().uuid(), url: browserCaptureUrlSchema, browser: z.literal('CURRENT') }).strict();

export function captureUrlFromSearch(search: string): string | null {
  const result = browserCaptureUrlSchema.safeParse(new URLSearchParams(search).get('captureUrl'));
  return result.success ? result.data : null;
}
export function captureResumeFromSearch(search: string): z.infer<typeof pendingBrowserCaptureSchema> | null {
  const params = new URLSearchParams(search);
  const result = pendingBrowserCaptureSchema.safeParse({ id: params.get('captureJob'), requestId: params.get('captureRequest'), url: params.get('captureUrl'), browser: 'CURRENT' });
  return result.success ? result.data : null;
}
const imageId = z.string().regex(/^[a-f0-9]{32}$/);
const images = { source_image_id: imageId.nullable().optional(), anonymous_image_id: imageId.nullable().optional() };
const capturedPostSchema = z.object({
  url: browserCaptureUrlSchema, platform: z.enum(['facebook', 'threads']), text: z.string().min(1).max(5000), author: z.string().max(100), ...images,
  comments: z.array(z.object({ text: z.string().min(1).max(2000), author: z.string().max(100), reaction_count: z.number().int().min(0).max(1e12).nullable().optional(), ...images })).max(30),
  warnings: z.array(z.string().max(2000)).max(100), comment_pool_size: z.number().int().nonnegative(),
});
const identity = { source: z.literal('shorts-factory-extension'), requestId: z.string().uuid() };
const job = { ...identity, jobId: z.string().uuid() };
export const browserCaptureMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...identity, type: z.literal('PONG'), version: z.string().max(40).optional() }),
  z.object({ ...job, type: z.literal('PREPARED') }),
  z.object({ ...job, type: z.literal('CAPTURE_IMAGE'), imageId, pngBase64: z.string().min(12).max(28_000_000) }),
  z.object({ ...job, type: z.literal('CAPTURE_RESULT'), post: capturedPostSchema }),
  z.object({ ...job, type: z.literal('CAPTURE_ERROR'), error: z.string().max(2000) }),
  z.object({ ...job, type: z.literal('CAPTURE_CANCELLED') }),
]);

export function decodeCapturePng(base64: string): Uint8Array<ArrayBuffer> {
  if (base64.length > 28_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Ảnh chụp không hợp lệ hoặc vượt 20 MB.');
  const decoded = atob(base64);
  if (decoded.length > 20 * 1024 * 1024 || !decoded.startsWith('\x89PNG\r\n\x1a\n')) throw new Error('Ảnh chụp phải là PNG và không vượt 20 MB.');
  return Uint8Array.from(decoded, value => value.charCodeAt(0));
}
