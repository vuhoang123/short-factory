import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalObjectStore, MockTtsProvider, DeterministicMockScriptProvider, createRenderManifest, renderVideo } from '../packages/media/src/index.js';

const root = path.resolve('.data/smoke-media');
const outputDirectory = path.resolve('test-results');
const outputPath = path.join(outputDirectory, 'phase3-smoke.mp4');
const workspaceId = randomUUID();
const source = {
  id: randomUUID(), platform: 'MANUAL' as const, title: 'A small neighborhood repair',
  body: 'A neighbor fixed a bicycle just before the rain began. People from nearby homes brought tools and helped finish the repair.',
  comments: [{ id: randomUUID(), body: 'Everyone stayed until the bike was ready to ride.' }],
};
const storyProjectId = randomUUID();
const storyVersionId = randomUUID();
const store = new LocalObjectStore(root);

if (!process.env.REMOTION_BROWSER_EXECUTABLE) {
  for (const candidate of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ]) if (existsSync(candidate)) { process.env.REMOTION_BROWSER_EXECUTABLE = candidate; break; }
}

const scriptResult = await new DeterministicMockScriptProvider().generate({ source, language: 'en', targetDurationSec: 20, style: 'STORYTELLING' });
const tts = new MockTtsProvider();
const audioSources: Record<string, string> = {};
const audioAssets = [] as Array<{ assetId: string; segmentId: string; durationMs: number }>;
for (const segment of scriptResult.script.segments) {
  const result = await tts.synthesize({ text: segment.text, language: 'en', voiceId: 'demo-tone', speakingRate: 1 });
  const object = await store.put(workspaceId, result.audio);
  const assetId = randomUUID();
  audioAssets.push({ assetId, segmentId: segment.id, durationMs: result.durationMs });
  audioSources[assetId] = `data:audio/wav;base64,${(await store.get(workspaceId, object.checksum)).toString('base64')}`;
}

const created = createRenderManifest({
  storyProjectId, storyVersionId, storyVersion: 1, sourcePostId: source.id, platform: source.platform,
  script: scriptResult.script, templateId: 'SocialCommentary', backgroundAssetId: null,
  attribution: { required: false, text: null }, visualSettings: { theme: 'dark', anonymizeAuthors: true, showEngagement: false },
  audioAssets, subtitlePreset: 'ClassicCaption',
});
await mkdir(outputDirectory, { recursive: true });
const temp = await mkdtemp(path.join(os.tmpdir(), 'sf-smoke-'));
try {
  const rendered = await renderVideo({ manifest: created.manifest, post: { title: source.title, body: source.body, authorAlias: null }, comments: source.comments.map((comment) => ({ ...comment, authorAlias: null })), backgroundSrc: null, audioSources }, path.join(temp, 'smoke.mp4'));
  const { copyFile } = await import('node:fs/promises');
  await copyFile(path.join(temp, 'smoke.mp4'), outputPath);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', outputPath, checksum: created.checksum, ...rendered })}\n`);
} finally { await rm(temp, { recursive: true, force: true }); }
