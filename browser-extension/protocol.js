const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);

export function sourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('CAPTURE_URL_INVALID');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !hosts.has(url.hostname)) throw new Error('CAPTURE_URL_INVALID');
  const facebook = url.hostname.endsWith('facebook.com');
  if (facebook ? !/\/(posts|permalink|share\/p)\/[^/]+/.test(url.pathname) && !/\/(story|permalink)\.php$/.test(url.pathname) : !/^\/@[^/]+\/post\/[\w-]+/.test(url.pathname)) throw new Error('CAPTURE_POST_URL_REQUIRED');
  if (facebook && /\.php$/.test(url.pathname) && (!url.searchParams.get('story_fbid') || !url.searchParams.get('id'))) throw new Error('CAPTURE_POST_URL_REQUIRED');
  url.hash = '';
  if (!url.pathname.endsWith('.php')) url.search = '';
  return url.toString();
}

export function sourceIdentity(value) {
  const url = new URL(sourceUrl(value));
  if (url.hostname.endsWith('facebook.com')) {
    if (url.pathname.endsWith('.php')) return `facebook:post:${url.searchParams.get('story_fbid')}`;
    const match = url.pathname.match(/\/(posts|permalink|share\/p)\/([^/]+)/);
    return `facebook:${match[1] === 'share/p' ? 'share' : 'post'}:${match[2]}`;
  }
  return `threads:post:${url.pathname.split('/post/')[1].split('/')[0]}`;
}

export function studioOrigin(value) {
  try { const url = new URL(value); return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '3000' && !url.username && !url.password ? url.origin : null; }
  catch { return null; }
}

export function captureRequest(message) {
  if (!message || !uuid.test(message.requestId) || !uuid.test(message.jobId)) throw new Error('CAPTURE_REQUEST_INVALID');
  return { requestId: message.requestId, jobId: message.jobId, url: sourceUrl(message.url) };
}

export function matchingSource(pending, value) {
  try {
    const current = sourceIdentity(value), expected = sourceIdentity(pending.url);
    if (!expected.includes(':share:')) return current === expected;
    return current.startsWith('facebook:post:') && current === pending.resolvedIdentity;
  } catch { return false; }
}

export function safeError(error) {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message) ? error.message : 'CAPTURE_EXTENSION_FAILED';
}
