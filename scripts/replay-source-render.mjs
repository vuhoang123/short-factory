import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '../packages/database/generated/client/index.js';
import { LocalObjectStore, renderManifestSchema, renderVideo } from '../packages/media/src/index.ts';
const runId = process.argv.find(value => value.startsWith('--run='))?.slice(6);
assert.match(runId ?? '', /^[a-f0-9-]{36}$/u);
assert(process.env.TEST_DATABASE_URL && new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
try {
  const row = await db.renderManifest.findFirstOrThrow({ where: { productionRunId: runId }, include: { workspace: true } });
  const manifest = renderManifestSchema.parse(row.manifest);
  assert(manifest.sourceImages?.length, 'Only replay the owned source screenshot smoke.');
  assert.match(row.workspace.slug, /^m2-[a-f0-9-]{36}$/u);
  const store = new LocalObjectStore(path.resolve('.data/milestone2-smoke', row.workspace.slug.slice(3)));
  const post = await db.sourcePost.findUniqueOrThrow({ where: { id: manifest.sourcePostId }, include: { comments: true } });
  assert.equal(post.canonicalUrl, 'https://www.facebook.com/owned-fixture/posts/synthetic');
  process.env.REMOTION_BROWSER_EXECUTABLE ??= ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  process.env.MEDIA_RENDER_CONCURRENCY = '1';
  process.env.TTS_VIENEU_VOICES_FILE = path.resolve('test-results/source-video/voices.json');
  if (process.argv.includes('--pipeline')) {
    const run = await db.productionRun.findUniqueOrThrow({ where: { id: runId } });
    const { ProductionService } = await import('../apps/api/src/production.service.ts');
    const { MediaProductionPipeline } = await import('../workers/media/src/pipeline.ts');
    const { readMediaWorkerConfig } = await import('../workers/media/src/config.ts');
    const service = new ProductionService(db, { context: async () => ({ workspaceId: row.workspaceId, userId: run.requestedById, role: 'OWNER' }) });
    const operationKey = randomUUID();
    const queued = await service.retryRun({ header: name => name === 'idempotency-key' ? operationKey : undefined }, runId);
    const event = await db.outboxEvent.findUniqueOrThrow({ where: { id: queued.outboxEventId } });
    await db.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
    const config = readMediaWorkerConfig({ ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, TTS_PROVIDER: 'vieneu', TTS_VIENEU_VOICES_FILE: path.resolve('test-results/source-video/voices.json'), STORAGE_LOCAL_ROOT: path.resolve('.data/milestone2-smoke', row.workspace.slug.slice(3)), MEDIA_RETRY_ATTEMPTS: '1' });
    await new MediaProductionPipeline(db, config).process({ jobId: event.id, workspaceId: row.workspaceId, entityId: runId, step: 'PRODUCTION_RUN_REQUESTED', version: event.payload.version, idempotencyKey: event.id, traceId: event.id, attempt: 0, scheduledAt: new Date().toISOString() });
    const completed = await db.productionRun.findUniqueOrThrow({ where: { id: runId }, include: { videos: { include: { mediaAsset: true } } } });
    assert.equal(completed.status, 'SUCCEEDED', completed.errorCode ?? 'Pipeline did not complete');
    const asset = completed.videos[0].mediaAsset;
    await writeFile(path.resolve('test-results/source-video/original-25s.mp4'), await store.get(row.workspaceId, asset.checksum));
    await writeFile(path.resolve('test-results/source-video/evidence.json'), JSON.stringify({ status: 'PASS', source: 'owned_synthetic_DOM_actual_screenshots', runId, attempt: completed.attempts, recoveredThrough: 'ProductionService.retryRun -> durable outbox -> MediaProductionPipeline', neuralAudioReused: true, originalScreenshots: manifest.sourceImages.length, ...asset.metadata }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', runId, attempt: completed.attempts, ...asset.metadata }));
    process.exitCode = 0;
  } else {
  const audioSources = {}, sourceImageSources = {};
  for (const audio of manifest.audioAssets) {
    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: audio.assetId } });
    audioSources[asset.id] = `data:${asset.mimeType};base64,${(await store.get(row.workspaceId, asset.checksum)).toString('base64')}`;
  }
  for (const image of manifest.sourceImages) sourceImageSources[image.assetId] = `data:image/png;base64,${(await store.get(row.workspaceId, image.checksum)).toString('base64')}`;
  const input = { manifest, post: { title: post.title, body: post.body, authorAlias: null }, comments: post.comments.map(comment => ({ id: comment.id, body: comment.body, authorAlias: null })), backgroundSrc: null, audioSources, sourceImageSources };
  process.env.REMOTION_BROWSER_EXECUTABLE ??= ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  process.env.MEDIA_RENDER_CONCURRENCY = '1';
  const output = path.resolve('test-results/source-video/original-25s.mp4');
  await writeFile(path.resolve('test-results/source-video/render-input.json'), JSON.stringify(input));
  const result = await renderVideo(input, output, progress => { if (progress.progress === 1) console.log('Frames rendered'); });
  console.log(JSON.stringify({ status: 'PASS', source: 'replayed_owned_smoke_manifest', output, ...result }));
  }
} finally { await db.$disconnect(); }
