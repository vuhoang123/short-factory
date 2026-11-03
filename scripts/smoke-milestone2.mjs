import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fork, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

if (process.env.NODE_ENV === 'production') throw new Error('Smoke is disabled in production.');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test') || !process.env.REDIS_URL) throw new Error('Use a migrated dedicated *_test database and local Redis.');
const root = process.cwd();
const namespace = randomUUID();
const sourceCapture = process.argv.includes('--source-capture');
const studioMedia = process.argv.includes('--studio-media');
assert(!studioMedia || sourceCapture, 'Studio media smoke uses the original screenshot fixture.');
const targetArgument = process.argv.find((value) => value.startsWith('--targets='));
const targets = targetArgument ? targetArgument.slice('--targets='.length).split(',').map(Number) : [40, 60, 120];
assert(targets.length > 0 && targets.every((value) => (sourceCapture ? [25, 40, 60, 120] : [40, 60, 120]).includes(value)), 'Use supported target durations; source screenshot fixture also supports 25 seconds.');
const directory = path.join(root, 'test-results', studioMedia ? 'studio-maker' : sourceCapture ? 'source-video' : 'milestone-2');
await mkdir(directory, { recursive: true });
async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
const port = await freePort(); const speechPort = await freePort();
const origin = `http://127.0.0.1:${port}`;
const python = path.join(root, '.data', 'tts-vieneu', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) throw new Error('Run pnpm local:tts:setup first.');
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, APP_URL: origin, API_HOST: '127.0.0.1', API_PORT: String(port), ALLOW_REGISTRATION: 'true', SCRIPT_PROVIDER: 'mock', TTS_PROVIDER: 'vieneu', PUBLISHER_PROVIDER: 'mock', ANALYTICS_LIVE_ENABLED: 'false', LOCAL_ALIGNMENT_ENABLED: '1', TTS_LOCAL_TOKEN: randomBytes(32).toString('hex'), TTS_LOCAL_PORT: String(speechPort), TTS_LOCAL_URL: `http://127.0.0.1:${speechPort}/speech`, TTS_VIENEU_VOICES_FILE: path.join(directory, 'voices.json'), HF_HOME: path.join(root, '.data', 'tts-vieneu', 'hf'), HF_HUB_OFFLINE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.base.json'), STORAGE_LOCAL_ROOT: path.join(root, '.data', 'milestone2-smoke', namespace), DISCOVERY_QUEUE_NAME: `m2-discovery-${namespace}`, MEDIA_QUEUE_NAME: `m2-media-${namespace}`, DISCOVERY_RELAY_INTERVAL_MS: '1000', MEDIA_RELAY_INTERVAL_MS: '1000', MEDIA_RETRY_ATTEMPTS: '1', MEDIA_RENDER_CONCURRENCY: '1', ...(browser ? { REMOTION_BROWSER_EXECUTABLE: browser } : {}) };
let captureBridge;
if (sourceCapture) {
  const capturePort = await freePort();
  env.LOCAL_CAPTURE_ENABLED = '1'; env.LOCAL_CAPTURE_URL = `http://127.0.0.1:${capturePort}`; env.LOCAL_CAPTURE_TOKEN = randomBytes(32).toString('hex');
  const fixture = JSON.parse(await readFile(path.join(root, 'examples', 'source-capture', 'capture.json'), 'utf8'));
  captureBridge = createHttpServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${env.LOCAL_CAPTURE_TOKEN}`);
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (request.url === '/image') {
        assert.match(input.imageId, /^[a-f0-9]{32}$/u);
        response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(await readFile(path.join(root, 'examples', 'source-capture', `${input.imageId}.png`))); return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(request.url === '/capture' ? { ...fixture, comment_pool_size: 5 } : { ok: true }));
    } catch { response.writeHead(400); response.end(); }
  });
  await new Promise(resolve => captureBridge.listen(capturePort, '127.0.0.1', resolve));
}
const children = [];
function start(file) {
  const child = fork(file, [], { cwd: root, env, execArgv: ['--import', 'tsx'], windowsHide: true, stdio: 'ignore' });
  children.push(child); return child;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cookie = '';
async function api(route, body, key = randomUUID()) {
  const response = await fetch(`${origin}/api/v1${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
  const data = await response.json();
  assert(response.ok, `${route}: HTTP ${response.status} ${data.code ?? ''}`);
  return data;
}
async function waitRun(id) {
  let prior = '';
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    const run = await api(`/production-runs/${id}`);
    if (run.currentStage !== prior) { console.log(JSON.stringify({ runId: id, stage: run.currentStage })); prior = run.currentStage; }
    if (run.status === 'SUCCEEDED') return run;
    assert(!/^(FAILED|BLOCKED|CANCELLED)/u.test(run.status), `${run.status}: ${run.errorCode}`);
    await sleep(1000);
  }
  throw new Error('Production smoke timed out.');
}
const started = Date.now();
try {
  const speech = spawn(python, ['scripts/local-tts-server.py'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  speech.stdout.on('data', (chunk) => { for (const line of chunk.toString().split('\n')) { try { const value = JSON.parse(line); if (value.errorType) console.log(JSON.stringify(value)); } catch { /* Only emit structured bridge diagnostics. */ } } });
  let startupError = '';
  const captureStartupError = (chunk) => { startupError = (startupError + chunk.toString()).slice(-2500); };
  speech.stderr.on('data', captureStartupError);
  children.push(speech);
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    assert(speech.exitCode === null, `Local speech exited: ${startupError}`);
    try { const health = await fetch(`http://127.0.0.1:${speechPort}/health`, { signal: AbortSignal.timeout(1000) }); if (health.ok) { assert.match((await health.json()).alignment, /base/u); ready = true; break; } } catch { /* Wait for models. */ }
    await sleep(1000);
  }
  assert(ready, 'Model startup timed out.');
  speech.stderr.removeListener('data', captureStartupError); speech.stderr.resume();
  start('apps/api/src/main.ts');
  for (let attempt = 0; ; attempt++) { try { await api('/health'); break; } catch { assert(attempt < 60, 'API startup timed out.'); await sleep(500); } }
  start('workers/discovery/src/main.ts'); start('workers/media/src/main.ts');
  await api('/auth/register', { email: `milestone2-${namespace}@example.org`, password: `${randomUUID()}-fixture`, name: 'Milestone 2 synthetic test' });
  const workspace = await api('/workspaces', { name: 'Milestone 2 synthetic verification', slug: `m2-${namespace}` });
  const channel = await api('/channels', { name: 'Owned Vietnamese fixtures', language: 'vi', minimumCandidateScore: 0 });
  const sentences = [
    'Khu phố của chúng tôi vừa mở một góc đọc sách nhỏ trong nhà sinh hoạt chung.',
    'Ban đầu chỉ có một chiếc kệ gỗ và vài cuốn truyện do hàng xóm mang tới.',
    'Mỗi chiều cuối tuần, các gia đình thay phiên nhau mở cửa để các em vào đọc.',
    'Những cuốn sách cũ được lau sạch và ghi lại tên trước khi xếp lên từng ngăn.',
    'Các em tự chọn một cuốn yêu thích rồi kể lại câu chuyện cho bạn bè cùng nghe.',
    'Có người mang thêm bàn ghế, có người giúp sửa chiếc đèn cạnh khung cửa sổ.',
    'Một bác hàng xóm còn làm tấm biển nhỏ để mọi người dễ nhận ra lối vào.',
    'Sau buổi đọc đầu tiên, chúng tôi để một cuốn sổ ghi những điều cần cải thiện.',
    'Nhiều phụ huynh đề nghị có thêm sách khoa học và những câu chuyện về thiên nhiên.',
    'Nhóm phụ trách thống nhất chỉ nhận những cuốn còn nguyên trang và phù hợp với trẻ.',
    'Mỗi người góp một ít thời gian nên việc trông coi không trở thành gánh nặng riêng.',
    'Khi có cuốn sách bị rách, cả nhóm cùng tìm cách sửa trước khi mang ra đọc tiếp.',
    'Chúng tôi đặt thêm một chiếc hộp để các em gửi lời nhắn và gợi ý đầu sách.',
    'Những lời nhắn ấy giúp nhóm biết góc đọc cần thay đổi ra sao trong tháng tới.',
    'Vào ngày trời mưa, mọi người cùng kéo bàn vào trong để sách không bị ướt.',
    'Một số bạn lớn nhận hướng dẫn các em nhỏ tìm sách và giữ yên lặng khi đọc.',
    'Cuối buổi, mỗi người tự đặt sách về đúng ngăn rồi cùng dọn sạch bàn ghế.',
    'Không gian tuy nhỏ nhưng đã trở thành nơi để hàng xóm gặp nhau sau một tuần bận rộn.',
    'Nhóm vẫn giữ nguyên tắc mọi thay đổi đều được trao đổi rõ ràng với các gia đình.',
    'Chúng tôi mong góc đọc có thể tiếp tục duy trì bằng những đóng góp vừa sức của mọi người.',
  ];
  const comments = [
    'Mình có vài cuốn truyện còn mới để tặng thêm cho góc đọc.',
    'Các em sẽ vui hơn khi được tự chọn những cuốn sách mình thích.',
    'Nhà mình có thể giúp trông coi vào chiều cuối tuần này.',
    'Mọi người nhớ ghi rõ lịch mở cửa để các gia đình tiện sắp xếp.',
    'Một chiếc kệ nhỏ cũng có thể tạo ra nhiều cuộc gặp gỡ hay.',
    'Mình muốn cùng các bạn lớn tổ chức buổi kể chuyện cho các em.',
    'Những cuốn sách về thiên nhiên sẽ rất phù hợp với góc đọc này.',
    'Cần giữ không gian sạch sẽ để sách có thể dùng được lâu hơn.',
    'Cả khu phố cùng góp sức thì việc duy trì sẽ nhẹ nhàng hơn.',
    'Mong các em luôn giữ được niềm vui khi khám phá những cuốn sách.',
  ].map((body, index) => ({ externalId: `owned-${index}`, body: `${body} Mình sẽ trao đổi cụ thể với nhóm trong buổi gặp tiếp theo.`, likes: 100 - index }));
  let imported;
  if (sourceCapture) {
    const requested = await api('/source-captures', { channelId: channel.id, url: 'https://www.facebook.com/owned-fixture/posts/synthetic' });
    for (let attempt = 0; attempt < 90; attempt++) {
      const capture = await api(`/source-captures/${requested.id}`);
      assert(!['FAILED', 'CANCELLED'].includes(capture.status), `Capture failed: ${capture.errorCode}`);
      if (capture.status === 'SUCCEEDED') { imported = { postId: capture.output.postId }; break; }
      await sleep(500);
    }
    assert(imported, 'Capture pipeline timed out.');
    assert.equal((await api(`/posts/${imported.postId}/source-images`)).items.length, 12);
  } else imported = await api('/imports/manual', { platform: 'MANUAL', canonicalUrl: `https://example.org/milestone2-owned-${namespace}`, channelId: channel.id, title: 'Góc đọc sách của khu phố', body: sentences.join(' '), comments, rights: { basis: 'OWNED', attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], territory: 'VN', evidence: 'Synthetic original fixture authored for software tests; unrelated to the supplied Facebook post.' } });
  await api(`/posts/${imported.postId}/rights/review`, { decision: 'APPROVED', ...(sourceCapture ? { basis: 'OWNED', evidence: 'Original synthetic DOM and text authored by this project; actual screenshots captured by the engine, no social account.', attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], territory: 'WORLDWIDE' } : {}) });
  let candidate;
  for (let attempt = 0; attempt < 60; attempt++) { candidate = (await api(`/candidates?sourcePostId=${imported.postId}&limit=1`)).items[0]; if (candidate) break; await sleep(500); }
  assert(candidate); await api(`/candidates/${candidate.id}/review`, { decision: 'APPROVED' });
  const profile = (await api('/voice-profiles')).items[0]; assert.equal(profile.provider, 'vieneu');
  let mediaOptions = {};
  if (studioMedia) {
    const { RenderInternals } = createRequire(new URL('../packages/media/package.json', import.meta.url))('@remotion/renderer');
    const ffmpeg = RenderInternals.getExecutablePath({ type: 'ffmpeg', logLevel: 'error', indent: false, binariesDirectory: null });
    const generated = spawnSync(python, ['-c', `import subprocess, pathlib, wave, math, struct, sys, random
from PIL import Image, ImageChops
out=pathlib.Path(sys.argv[1])
base=Image.frombytes('RGB',(720,1280),random.Random(7).randbytes(720*1280*3))
for n in range(10): ImageChops.offset(base,n*16,n*8).save(out/('frame-%02d.png'%n))
result=subprocess.run([sys.argv[2], '-y', '-framerate', '5', '-i', str(out/'frame-%02d.png'), '-t', '2', '-r', '30', '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', '-an', str(out/'background.mp4')], capture_output=True, timeout=30)
if result.returncode: print(result.stderr.decode(errors='replace')[-2500:],file=sys.stderr); sys.exit(1)
for p in out.glob('frame-*.png'): p.unlink()
with wave.open(str(out/'music.wav'),'wb') as track:
 track.setparams((1,2,16000,0,'NONE','not compressed'))
 track.writeframes(b''.join(struct.pack('<h',int(math.sin(i*2*math.pi*880/16000)*5000)) for i in range(16000)))
`, directory, ffmpeg], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 45000 });
    assert.equal(generated.status, 0, generated.stderr);
    async function upload(route, filename, type) {
      const data = await readFile(path.join(directory, filename));
      if (type === 'video/mp4') assert(data.length > 100_000, 'Exercise real OffthreadVideo URLs larger than HTTP headers.');
      const response = await fetch(`${origin}/api/v1${route}`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': type, 'Idempotency-Key': randomUUID(), 'X-Asset-Encoding': 'uri', 'X-Asset-Name': filename, 'X-Rights-Basis': 'OWNED', 'X-Rights-Attested': 'true' }, body: data, signal: AbortSignal.timeout(30000) });
      assert(response.ok, `Media upload ${route}: ${response.status}`); return response.json();
    }
    const background = await upload('/backgrounds', 'background.mp4', 'video/mp4');
    const music = await upload('/music', 'music.wav', 'audio/wav');
    mediaOptions = { backgroundAssetId: background.id, mediaSettings: { musicAssetId: music.id, musicVolume: 0.2, ducking: true, backgroundStartSec: 0.5, captionSize: 52, captionColor: '#ffffff', captionPosition: 'BOTTOM' } };
    const preset = await api('/studio-presets', { name: 'Owned local media smoke', settings: { voiceProfileId: profile.id, ...mediaOptions } });
    assert.equal(preset.settings.mediaSettings.musicAssetId, music.id);
  }
  const evidence = [];
  for (const targetDurationSec of targets) {
    const draft = await api(`/candidates/${candidate.id}/produce`, { channelId: channel.id, commentSelection: 'TOP_REACTIONS', language: 'vi', voiceProfileId: profile.id, targetDurationSec, draftOnly: true, subtitlePreset: 'KaraokeHighlight' });
    const drafted = await waitRun(draft.runId);
    assert.equal(drafted.currentStage, 'SCRIPT_READY');
    const story = await api(`/stories/${draft.storyProjectId}`);
    const expectedCount = targetDurationSec === 120 ? 10 : 5;
    assert.equal(story.versions[0].script.segments.filter((segment) => segment.type === 'COMMENT').length, expectedCount);
    assert.equal(story.versions[0].audioAssets.length, 0);
    if (targetDurationSec === 40) {
      const preview = await api(`/stories/${draft.storyProjectId}/audio`, { voiceProfileId: profile.id, speakingRate: 1.15, preview: true });
      const previewed = await waitRun(preview.runId); assert.equal(previewed.currentStage, 'AUDIO_READY'); assert.equal(previewed.videos.length, 0);
      const assets = (await api(`/stories/${draft.storyProjectId}`)).versions[0].audioAssets;
      assert.equal(assets.length, 1); assert.equal(assets[0].segmentId, 'voice-preview'); assert(assets[0].durationMs < 15000);
    }
    const renderKey = randomUUID();
    const rendered = await api(`/stories/${draft.storyProjectId}/render`, { speakingRate: 1, subtitlePreset: 'KaraokeHighlight', ...mediaOptions }, renderKey);
    assert.deepEqual(await api(`/stories/${draft.storyProjectId}/render`, { speakingRate: 1, subtitlePreset: 'KaraokeHighlight', ...mediaOptions }, renderKey), rendered);
    const completed = await waitRun(rendered.runId);
    const alignment = completed.stages.find((stage) => stage.name === 'AUDIO_ALIGNMENT').output;
    assert.equal(alignment.timingPrecision, 'PROVIDER'); assert.match(alignment.provider, /base/u);
    const fit = completed.stages.find((stage) => stage.name === 'DURATION_FIT').output;
    const video = await api(`/videos/${completed.videos[0].id}`);
    assert(Math.abs(video.durationMs - targetDurationSec * 1000) <= 100);
    assert.equal(video.reviewStatus, 'PENDING'); assert.equal(video.width, 1080); assert.equal(video.height, 1920);
    const manifest = video.renderManifest;
    if (studioMedia) { assert.equal(manifest.mediaSettings.musicAssetId, mediaOptions.mediaSettings.musicAssetId); assert.equal(manifest.backgroundVideo.startFrame, 15); assert.equal(manifest.mediaSettings.ducking, true); assert.equal(manifest.mediaSettings.captionSize, 52); }
    if (sourceCapture) { assert.equal(manifest.sourceImages.length, 6); assert(manifest.sourceImages.every(image => image.anonymized)); }
    assert(manifest.subtitleTimeline.every((cue) => cue.words?.length && cue.endMs <= video.durationMs));
    await api(`/videos/${video.id}/reviews`, { decision: 'APPROVED' });
    const download = await fetch(`${origin}/api/v1/media/${video.mediaAsset.id}?download=1`, { headers: { Cookie: cookie } });
    assert(download.ok); assert.match(download.headers.get('content-disposition'), /attachment/u);
    const bytes = Buffer.from(await download.arrayBuffer()); assert.equal(bytes.toString('ascii', 4, 8), 'ftyp');
    const output = path.join(directory, `${sourceCapture ? 'original' : 'local'}-${targetDurationSec}s.mp4`);
    await writeFile(output, bytes); await writeFile(path.join(directory, `local-${targetDurationSec}s.srt`), (await api(`/stories/${draft.storyProjectId}`)).versions[0].subtitleTracks[0].srt);
    evidence.push({ targetDurationSec, durationMs: video.durationMs, comments: expectedCount, originalDurationMs: fit.originalDurationMs, tempo: fit.tempo, forcedWordCount: alignment.segments.reduce((sum, segment) => sum + segment.providerTimings.length, 0), output, bytes: bytes.length, review: 'explicit_synthetic_fixture_approval', renderIdempotent: true });
    await writeFile(path.join(directory, `evidence-${targetDurationSec}.json`), JSON.stringify(evidence.at(-1), null, 2));
    console.log(JSON.stringify(evidence.at(-1)));
  }
  const report = { status: 'PASS', workspaceId: workspace.id, source: sourceCapture ? 'actual_screenshots_of_owned_synthetic_DOM_mocked_capture_transport' : 'original_synthetic_fixture_not_facebook_post', originalScreenshots: sourceCapture, localBackgroundVideoAndMusic: studioMedia, audio: 'NEURAL_VIENEU', alignment: 'multilingual-base-forced-DTW', networkForModels: 'offline_cached', shortPreview: targets.includes(40), paidApi: false, publishing: 'not_called', elapsedMs: Date.now() - started, videos: evidence };
  await writeFile(path.join(directory, targets.length === 3 ? 'evidence.json' : `evidence-${targets.join('-')}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (captureBridge) await new Promise(resolve => captureBridge.close(resolve));
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}
