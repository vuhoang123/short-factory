import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

if (process.env.NODE_ENV === 'production') throw new Error('Phase 6 smoke is disabled in production.');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Set TEST_DATABASE_URL to a migrated dedicated *_test database.');
if (!process.env.REDIS_URL) throw new Error('Set the local test REDIS_URL.');
const namespace = randomUUID();
const root = path.resolve('.');
const probe = createServer();
await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const address = probe.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
const browser = process.env.REMOTION_BROWSER_EXECUTABLE || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
const environment: NodeJS.ProcessEnv = {
  ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, APP_URL: origin, API_HOST: '127.0.0.1', API_PORT: String(port),
  ALLOW_REGISTRATION: 'true', SCRIPT_PROVIDER: 'mock', TTS_PROVIDER: 'mock', PUBLISHER_PROVIDER: 'mock', ANALYTICS_LIVE_ENABLED: 'false',
  TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.base.json'), STORAGE_LOCAL_ROOT: path.join(root, '.data', 'phase6-smoke', namespace),
  DISCOVERY_QUEUE_NAME: `phase6-discovery-${namespace}`, MEDIA_QUEUE_NAME: `phase6-media-${namespace}`,
  DISCOVERY_RELAY_INTERVAL_MS: '1000', MEDIA_RELAY_INTERVAL_MS: '1000', MEDIA_CANCEL_POLL_MS: '100',
  MEDIA_RETRY_ATTEMPTS: '1', MEDIA_RETRY_DELAY_MS: '100', MEDIA_RENDER_CONCURRENCY: '1',
  ...(browser ? { REMOTION_BROWSER_EXECUTABLE: browser } : {}),
};
const children = new Set<ChildProcess>();
function start(file: string, extra: NodeJS.ProcessEnv = {}) {
  const child = fork(file, [], { cwd: root, env: { ...environment, ...extra }, execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.add(child);
  child.stdout?.resume(); child.stderr?.resume();
  return child;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) { children.delete(child); return; }
  const closed = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await closed; clearTimeout(timer); children.delete(child);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let cookie = '';
async function api(route: string, body?: object, key = randomUUID()): Promise<unknown> {
  const response = await fetch(`${origin}/api/v1${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
  const value: unknown = await response.json();
  assert(response.ok, `${route}: HTTP ${response.status}`);
  return value;
}
function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected API object');
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  assert(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value), 'Expected API UUID');
  return value;
}
function id(value: unknown) { return { id: uuid(object(value).id) }; }
function items(value: unknown): unknown[] { const data = object(value); assert(Array.isArray(data.items)); return data.items; }
interface Run {
  id: string; status: string; currentStage: string | null; errorCode: string | null; workerLeaseUntil: string | null;
  attempts: number; videos: Array<{ id: string; mediaAsset: { id: string } | null }>;
}
function parseRun(value: unknown): Run {
  const data = object(value);
  assert(typeof data.status === 'string' && typeof data.attempts === 'number' && Array.isArray(data.videos));
  const nullable = (item: unknown): string | null => { assert(item === null || typeof item === 'string'); return item; };
  return { id: uuid(data.id), status: data.status, attempts: data.attempts, currentStage: nullable(data.currentStage),
    errorCode: nullable(data.errorCode), workerLeaseUntil: nullable(data.workerLeaseUntil),
    videos: data.videos.map((item) => { const video = object(item); return { id: uuid(video.id), mediaAsset: video.mediaAsset === null ? null : { id: uuid(object(video.mediaAsset).id) } }; }),
  };
}
async function waitRun(id: string, predicate: (run: Run) => boolean, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const run = parseRun(await api(`/production-runs/${id}`));
    if (predicate(run)) return run;
    if (run.status.startsWith('FAILED') || run.status.startsWith('BLOCKED')) throw new Error(`Unexpected production state: ${run.status}/${run.errorCode}`);
    await sleep(200);
  }
  throw new Error('Timed out waiting for production state.');
}

const started = Date.now();
try {
  start('apps/api/src/main.ts');
  for (let attempt = 0; ; attempt++) {
    try { await api('/health'); break; } catch { if (attempt >= 60) throw new Error('Local smoke API did not start.'); await sleep(500); }
  }
  start('workers/discovery/src/main.ts');
  await api('/auth/register', { email: `phase6-${namespace}@example.org`, password: `${randomUUID()}-fixture`, name: 'Phase 6 synthetic verification' });
  const workspace = id(await api('/workspaces', { name: 'Phase 6 synthetic reliability smoke', slug: `phase6-${namespace}` }));
  const channel = id(await api('/channels', { name: 'Reviewed local fixtures', language: 'vi', minimumCandidateScore: 0 }));
  const imported = object(await api('/imports/manual', {
    platform: 'MANUAL', canonicalUrl: `https://www.facebook.com/phase6/posts/${namespace}`, title: 'Câu chuyện thử nghiệm local',
    body: 'Mọi người cùng sửa chiếc xe đạp trước cơn mưa. Đây là nội dung tổng hợp chỉ dùng để kiểm chứng phần mềm local.', channelId: channel.id,
    comments: [1, 2, 3].map((i) => ({ externalId: `c${i}`, body: `Bình luận tổng hợp thứ ${i} dành riêng cho kiểm thử.` })),
    rights: { basis: 'OWNED', attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], territory: 'VN', evidence: 'Synthetic fixture created for local software verification.' },
  }));
  const postId = uuid(imported.postId);
  await api(`/posts/${postId}/rights/review`, { decision: 'APPROVED' });
  let candidateId: string | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = items(await api(`/candidates?sourcePostId=${postId}&limit=1`));
    candidateId = found[0] ? id(found[0]).id : undefined;
    if (candidateId) break;
    await sleep(500);
  }
  assert(candidateId, 'Discovery worker did not create the candidate.');
  await api(`/candidates/${candidateId}/review`, { decision: 'APPROVED' });
  const comments = items(await api(`/posts/${postId}/comments?limit=100`)).map(id);
  const produce = async () => ({ runId: uuid(object(await api(`/candidates/${candidateId}/produce`, { channelId: channel.id, commentIds: comments.map((item) => item.id), language: 'vi', voiceProfileId: 'mock:default', targetDurationSec: 10 })).runId) });

  const queued = await produce();
  await api(`/production-runs/${queued.runId}/cancel`, {});
  const rendering = await produce();
  let media = start('workers/media/src/main.ts');
  await waitRun(rendering.runId, (run) => run.currentStage === 'VIDEO_RENDER' && run.status === 'RUNNING');
  const cancelStart = Date.now();
  await api(`/production-runs/${rendering.runId}/cancel`, {});
  const cancelled = await waitRun(rendering.runId, (run) => run.status === 'CANCELLED' && run.workerLeaseUntil === null);
  assert(cancelled.videos.every((video) => video.mediaAsset === null));
  const cancelMs = Date.now() - cancelStart;
  await stop(media);
  media = start('workers/media/src/main.ts', { MEDIA_RENDER_TIMEOUT_MS: '1000' });
  const timed = await produce();
  const timeoutStart = Date.now();
  const timeout = await waitRun(timed.runId, (run) => run.status === 'FAILED_PERMANENT' && run.workerLeaseUntil === null);
  assert.equal(timeout.errorCode, 'MEDIA_RENDER_TIMEOUT');
  const timeoutMs = Date.now() - timeoutStart;
  await stop(media);
  start('workers/media/src/main.ts');
  await api(`/production-runs/${timed.runId}/retry`, {});
  const completed = await waitRun(timed.runId, (run) => run.status === 'SUCCEEDED', 600_000);
  assert.equal(completed.attempts, 2, 'Explicit retry must have a fresh durable attempt budget.');
  const video = completed.videos.find((item) => item.mediaAsset);
  assert(video?.mediaAsset);
  await api(`/videos/${video.id}/reviews`, { decision: 'APPROVED' });
  const download = await fetch(`${origin}/api/v1/media/${video.mediaAsset.id}?download=1`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30_000) });
  assert(download.ok); assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
  const bytes = Buffer.from(await download.arrayBuffer()); assert.equal(bytes.toString('ascii', 4, 8), 'ftyp');
  const history = { items: items(await api('/production-runs?limit=20')).map((item) => { const value = object(item); assert(typeof value.status === 'string'); return { id: uuid(value.id), status: value.status }; }) };
  assert.equal(history.items.length, 3);
  assert(history.items.some((run) => run.id === queued.runId && run.status === 'CANCELLED'));
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/phase6-smoke.mp4', bytes);
  const evidence = { status: 'PASS', workspaceId: workspace.id, queuedCancel: true, runningCancel: true, cancelMs, timeoutCode: timeout.errorCode, timeoutMs, explicitRetry: true, retryAttempts: completed.attempts, historyRuns: history.items.length, commentCount: comments.length, bytes: bytes.length, elapsedMs: Date.now() - started, audio: 'MOCK_TEST_TONE', database: 'dedicated_test', publishing: 'not_called' };
  await writeFile('test-results/phase6-smoke.json', JSON.stringify(evidence, null, 2));
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await Promise.all([...children].map(stop));
}
