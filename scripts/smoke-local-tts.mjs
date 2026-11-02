import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VieneuTtsProvider, validateVoiceReference } from '../packages/media/src/tts.ts';
import { createRenderManifest, LocalNarrationProcessor, renderVideo } from '../packages/media/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.data', 'tts-vieneu', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) throw new Error('Run pnpm local:tts:setup first.');
const socket = createServer();
await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const token = randomBytes(32).toString('hex');
const directory = path.join(root, 'test-results');
await mkdir(directory, { recursive: true });
const manifest = path.join(directory, 'vieneu-smoke-voices.json');
const env = { ...process.env, TTS_PROVIDER: 'vieneu', TTS_LOCAL_TOKEN: token, TTS_LOCAL_PORT: String(port), TTS_LOCAL_URL: `http://127.0.0.1:${port}/speech`, TTS_VIENEU_VOICES_FILE: manifest, HF_HOME: path.join(root, '.data', 'tts-vieneu', 'hf'), HF_HUB_DISABLE_SYMLINKS_WARNING: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
if (process.argv.includes('--alignment')) env.LOCAL_ALIGNMENT_ENABLED = '1';
const child = spawn(python, [path.join(root, 'scripts', 'local-tts-server.py')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.on('data', (chunk) => { for (const line of chunk.toString().split('\n')) { try { const value = JSON.parse(line); if (value.errorType) console.log(JSON.stringify(value)); } catch { /* Only emit structured, redacted bridge diagnostics. */ } } });
const started = Date.now();
try {
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    if (child.exitCode !== null) throw new Error('Neural speech server exited before readiness.');
    try { const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch { /* Waiting for the local model. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(ready, 'Local model startup timed out.');
  const voices = JSON.parse(await readFile(manifest, 'utf8'));
  assert(voices.voices.length > 0);
  assert.equal((await fetch(env.TTS_LOCAL_URL, { method: 'POST', body: '{}' })).status, 403);
  const provider = new VieneuTtsProvider(env);
  const first = await provider.synthesize({ text: 'Xin chào, tôi đang đọc một câu chuyện về thư viện nhỏ trong khu phố bằng giọng tiếng Việt chạy hoàn toàn trên máy của bạn.', language: 'vi', voiceId: voices.voices[0].voiceId, speakingRate: 1 });
  validateVoiceReference(first.audio);
  await writeFile(path.join(directory, 'vieneu-narration.wav'), first.audio);
  const custom = await provider.synthesize({ text: 'Đây là đoạn kiểm tra giọng riêng được tạo từ mẫu tổng hợp của phần mềm, không phải bản thu của người dùng.', language: 'vi', voiceId: randomUUID(), speakingRate: 1.15, referenceAudio: first.audio });
  assert(custom.durationMs > 1000);
  await writeFile(path.join(directory, 'vieneu-custom-smoke.wav'), custom.audio);
  const evidence = { status: 'PASS', model: voices.version, voiceCount: voices.voices.length, presetDurationMs: first.durationMs, customDurationMs: custom.durationMs, presetBytes: first.audio.length, customVoice: true, speakingRate: 1.15, unauthorizedDenied: true, elapsedMs: Date.now() - started, audio: 'NEURAL_VIENEU', reference: 'software_generated_fixture', paidApi: false };
  if (process.argv.includes('--alignment')) {
    const processor = new LocalNarrationProcessor(env);
    const aligned = await processor.align(first.audio, 'Xin chào, tôi đang đọc một câu chuyện về thư viện nhỏ trong khu phố bằng giọng tiếng Việt chạy hoàn toàn trên máy của bạn.', 'vi', first.durationMs);
    await processor.release();
    evidence.alignment = { provider: aligned.provider, wordCount: aligned.words.length, words: aligned.words };
  }
  if (process.argv.includes('--render')) {
    process.env.TSX_TSCONFIG_PATH = path.join(root, 'tsconfig.base.json');
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    if (browser && !process.env.REMOTION_BROWSER_EXECUTABLE) process.env.REMOTION_BROWSER_EXECUTABLE = browser;
    const sourceId = randomUUID(); const firstId = randomUUID(); const secondId = randomUUID();
    const title = 'Xin chào, tôi đang đọc một câu chuyện về thư viện nhỏ trong khu phố bằng giọng tiếng Việt chạy hoàn toàn trên máy của bạn.';
    const body = 'Đây là đoạn kiểm tra giọng riêng được tạo từ mẫu tổng hợp của phần mềm, không phải bản thu của người dùng.';
    const script = { version: 1, language: 'vi', title: 'Kiểm tra lời đọc neural local', targetDurationSec: 25, segments: [
      { id: 'hook', type: 'HOOK', text: title, sourceRefs: [`post:${sourceId}`], narrationType: 'VERBATIM' },
      { id: 'post', type: 'POST', text: body, sourceRefs: [`post:${sourceId}`], narrationType: 'VERBATIM' },
    ] };
    const created = createRenderManifest({ storyProjectId: randomUUID(), storyVersionId: randomUUID(), storyVersion: 1, sourcePostId: sourceId, platform: 'MANUAL', script, templateId: 'SocialCommentary', backgroundAssetId: null, attribution: { required: false, text: null }, visualSettings: { theme: 'dark', anonymizeAuthors: true, showEngagement: false }, audioAssets: [{ assetId: firstId, segmentId: 'hook', durationMs: first.durationMs }, { assetId: secondId, segmentId: 'post', durationMs: custom.durationMs }], subtitlePreset: 'ClassicCaption' });
    const output = path.join(directory, 'vieneu-neural-smoke.mp4');
    const rendered = await renderVideo({ manifest: created.manifest, post: { title, body, authorAlias: null }, comments: [], backgroundSrc: null, audioSources: { [firstId]: `data:audio/wav;base64,${first.audio.toString('base64')}`, [secondId]: `data:audio/wav;base64,${custom.audio.toString('base64')}` } }, output);
    assert.equal(rendered.width, 1080); assert.equal(rendered.height, 1920);
    evidence.mp4 = { output, ...rendered };
    evidence.elapsedMs = Date.now() - started;
  }
  await writeFile(path.join(directory, 'local-tts-smoke.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  if (child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}
