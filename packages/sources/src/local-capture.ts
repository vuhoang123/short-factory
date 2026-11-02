import { z } from 'zod';

const hosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);
export const captureUrlSchema = z.string().trim().url().max(2048).superRefine((value, ctx) => {
  const url = new URL(value);
  const facebook = url.hostname.endsWith('facebook.com');
  if (url.protocol !== 'https:' || url.username || url.password || !hosts.has(url.hostname) || (url.port && url.port !== '443') ||
    !(facebook ? /\/(posts|permalink|share\/p)\/[^/]+/.test(url.pathname) || /\/(story|permalink)\.php$/.test(url.pathname) && Boolean(url.searchParams.get('story_fbid') && url.searchParams.get('id')) : /^\/@[^/]+\/post\/[\w-]+/.test(url.pathname))) {
    ctx.addIssue({ code: 'custom', message: 'Cần link bài Facebook hoặc Threads cụ thể qua HTTPS.' });
  }
}).transform(value => { const url = new URL(value); url.hash = ''; if (!url.pathname.endsWith('.php')) url.search = ''; return url.toString(); });
export const captureRequestSchema = z.object({ url: captureUrlSchema, channelId: z.string().uuid(), browser: z.literal('CURRENT').optional() }).strict();
export const captureInputSchema = captureRequestSchema.extend({ requestedById: z.string().uuid() });
const images = { source_image_id: z.string().regex(/^[a-f0-9]{32}$/).nullable().optional(), anonymous_image_id: z.string().regex(/^[a-f0-9]{32}$/).nullable().optional() };
export const capturedPostSchema = z.object({
  url: captureUrlSchema, platform: z.enum(['facebook', 'threads']), text: z.string().min(1).max(5000), author: z.string().max(100), ...images,
  comments: z.array(z.object({ text: z.string().min(1).max(2000), author: z.string().max(100), reaction_count: z.number().int().min(0).max(1e12).nullable().optional(), ...images })).max(30),
  warnings: z.array(z.string().max(2000)).max(100), comment_pool_size: z.number().int().nonnegative(),
});
export const currentBrowserResultSchema = z.object({ post: capturedPostSchema }).strict();
export const captureUploadMetadataSchema = z.object({ captureRunId: z.string().uuid(), imageId: z.string().regex(/^[a-f0-9]{32}$/), ownerUserId: z.string().uuid(), sizeBytes: z.number().int().positive() }).strict();

export function capturedImageIds(post: z.infer<typeof capturedPostSchema>): string[] {
  return [post, ...post.comments].flatMap(entry => [entry.source_image_id, entry.anonymous_image_id]).filter((id): id is string => Boolean(id));
}

/** Dedicated, user-opened profile only. Normal browser profiles/cookies are never read. */
export async function localCaptureCall(action: 'open' | 'capture' | 'image' | 'purge' | 'cancel', input: Record<string, string>, timeoutMs = 240_000): Promise<Response> {
  if (process.env.NODE_ENV === 'production' || process.env.LOCAL_CAPTURE_ENABLED !== '1') throw new Error('LOCAL_CAPTURE_DISABLED');
  const url = new URL(process.env.LOCAL_CAPTURE_URL ?? 'http://127.0.0.1:3003');
  const token = process.env.LOCAL_CAPTURE_TOKEN;
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || !token || token.length < 32) throw new Error('LOCAL_CAPTURE_CONFIG_INVALID');
  let response: Response;
  try { response = await fetch(new URL(`/${action}`, url), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new Error('LOCAL_CAPTURE_UNAVAILABLE'); }
  if (!response.ok) {
    const result = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/) }).safeParse(await response.json().catch(() => null));
    throw new Error(result.success ? result.data.code : 'LOCAL_CAPTURE_FAILED');
  }
  return response;
}
