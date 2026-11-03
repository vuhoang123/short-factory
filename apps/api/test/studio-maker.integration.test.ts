import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@shorts-factory/database';
import { MockTtsProvider } from '@shorts-factory/media';
import { createApp } from '../src/app.js';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
const integration = testUrl ? describe.sequential : describe.skip;
const prefix = '/api/v1'; const origin = process.env.APP_URL ?? 'http://localhost:3000';
type Agent = ReturnType<typeof supertest.agent>;

integration('Studio media library and reusable settings', () => {
  let db: PrismaClient; let app: INestApplication; let server: Server;
  let owner: Agent; let foreign: Agent; let viewer: Agent;
  const workspaces: string[] = []; const users: string[] = [];
  const namespace = randomUUID(); let storage = ''; const previousStore = process.env.STORAGE_LOCAL_ROOT;
  let voiceId = ''; let musicId = ''; let wav: Buffer;
  const previousCatalog = process.env.STUDIO_MEDIA_ROOT;
  const post = (agent: Agent, route: string, body: object, key = randomUUID()) => agent.post(`${prefix}${route}`).set('Origin', origin).set('Idempotency-Key', key).send(body);
  const upload = (agent: Agent, route: string, bytes: Buffer, mime: string, key = randomUUID()) => agent.post(`${prefix}${route}`).set('Origin', origin).set('Idempotency-Key', key).set('Content-Type', mime).set('X-Asset-Encoding', 'uri').set('X-Asset-Name', encodeURIComponent('Nhạc nền riêng')).set('X-Rights-Basis', 'OWNED').set('X-Rights-Attested', 'true').send(bytes);
  beforeAll(async () => {
    storage = await mkdtemp(path.join(os.tmpdir(), 'sf-studio-library-')); process.env.STORAGE_LOCAL_ROOT = storage;
    db = new PrismaClient({ datasourceUrl: testUrl }); app = await createApp(db); server = app.getHttpServer() as Server;
    for (const label of ['owner','foreign','viewer']) {
      const agent = supertest.agent(server);
      const user = await post(agent, '/auth/register', { email: `${namespace}-${label}@example.org`, password: 'a strong local test password' });
      expect(user.status).toBe(201); users.push(user.body.user.id as string);
      if (label !== 'viewer') { const workspace = await post(agent, '/workspaces', { name: label, slug: `${namespace}-${label}` }); expect(workspace.status).toBe(201); workspaces.push(workspace.body.id as string); }
      if (label === 'owner') owner = agent; else if (label === 'foreign') foreign = agent; else viewer = agent;
    }
    expect((await post(owner, `/workspaces/${workspaces[0]}/members`, { email: `${namespace}-viewer@example.org`, role: 'VIEWER' })).status).toBe(201);
    expect((await post(viewer, '/auth/workspace', { workspaceId: workspaces[0] })).status).toBe(201);
    voiceId = (await owner.get(`${prefix}/voice-profiles`)).body.items[0].id as string;
    wav = (await new MockTtsProvider().synthesize({ text: 'Nhạc thử do dự án tạo.', language: 'vi', voiceId: 'tone', speakingRate: 1 })).audio;
    process.env.STUDIO_MEDIA_ROOT = path.join(storage, '.catalog');
    await mkdir(process.env.STUDIO_MEDIA_ROOT);
    const clip = Buffer.from(wav); clip[clip.length - 1] = clip[clip.length - 1]! ^ 1;
    const thumbnail = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2UAAAAASUVORK5CYII=', 'base64');
    await writeFile(path.join(process.env.STUDIO_MEDIA_ROOT, 'test.wav'), clip);
    await writeFile(path.join(process.env.STUDIO_MEDIA_ROOT, 'test-thumb.png'), thumbnail);
    await writeFile(path.join(process.env.STUDIO_MEDIA_ROOT, 'catalog.json'), JSON.stringify({ version: 1, items: [{ key: 'test-track', kind: 'MUSIC', name: 'Synthetic CC0 fixture', category: 'Piano', artist: 'Test', description: 'Owned synthetic test audio', sourceUrl: 'https://opengameart.org/content/synthetic-test', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', verifiedAt: '2026-11-03', mimeType: 'audio/wav', durationMs: 1000, file: { file: 'test.wav', checksum: createHash('sha256').update(clip).digest('hex') }, thumbnail: { file: 'test-thumb.png', checksum: createHash('sha256').update(thumbnail).digest('hex') } }] }));
  });
  afterAll(async () => {
    if (db) { await db.workspace.deleteMany({ where: { id: { in: workspaces } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); }
    await app?.close(); process.env.STORAGE_LOCAL_ROOT = previousStore;
    if (previousStore === undefined) delete process.env.STORAGE_LOCAL_ROOT;
    if (previousCatalog === undefined) delete process.env.STUDIO_MEDIA_ROOT; else process.env.STUDIO_MEDIA_ROOT = previousCatalog;
    if (storage) await rm(storage, { recursive: true, force: true });
  });

  it('previews CC0 files and installs them idempotently into only the authenticated workspace', async () => {
    const catalog = await owner.get(`${prefix}/studio-assets`);
    expect(catalog.status).toBe(200); expect(catalog.body.items[0].license).toBe('CC0-1.0'); expect(catalog.body.items[0]).not.toHaveProperty('file');
    expect((await supertest(server).get(`${prefix}/studio-assets`)).status).toBe(401);
    expect((await owner.get(`${prefix}/studio-assets/test-track/preview`).set('Range', 'bytes=0-15')).status).toBe(206);
    const thumbnail = await owner.get(`${prefix}/studio-assets/test-track/thumbnail`);
    expect(thumbnail.status).toBe(200); expect(thumbnail.headers['content-type']).toContain('image/png');
    expect((await post(viewer, '/studio-assets', { keys: ['test-track'] })).status).toBe(403);
    const key = randomUUID(); const installed = await post(owner, '/studio-assets', { keys: ['test-track'] }, key);
    expect(installed.status).toBe(201); const assetId = installed.body.items[0].id as string;
    expect((await post(owner, '/studio-assets', { keys: ['test-track'] }, key)).body).toEqual(installed.body);
    expect((await post(owner, '/studio-assets', { keys: ['test-track'] })).body.items[0].id).toBe(assetId);
    expect((await foreign.get(`${prefix}/media/${assetId}`)).status).toBe(404);
    const imported = await post(foreign, '/studio-assets', { keys: ['test-track'] }); expect(imported.body.items[0].id).not.toBe(assetId);
    expect(await db.auditLog.count({ where: { workspaceId: workspaces[0], action: 'CURATED_MEDIA_IMPORTED' } })).toBe(1);
    expect((await post(owner, '/studio-assets', { keys: ['test-track'], workspaceId: workspaces[1] })).status).toBe(400);
    expect((await post(owner, '/studio-assets', { keys: ['test-track', 'test-track'] })).status).toBe(400);
    await writeFile(path.join(process.env.STUDIO_MEDIA_ROOT!, 'test.wav'), 'tampered');
    expect((await owner.get(`${prefix}/studio-assets/test-track/preview`)).status).toBe(404);
    expect((await post(owner, '/studio-assets', { keys: ['test-track'] })).status).toBe(409);
    await db.mediaAsset.deleteMany({ where: { id: { in: [assetId, String(imported.body.items[0].id)] } } });
  });

  it('uploads attested music idempotently, validates PCM, and serves private byte ranges', async () => {
    const key = randomUUID(); const result = await upload(owner, '/music', wav, 'audio/wav', key);
    expect(result.status).toBe(201); musicId = result.body.id as string;
    expect((await upload(owner, '/music', wav, 'audio/wav', key)).body).toEqual(result.body);
    const assets = await owner.get(`${prefix}/music`); expect(assets.body.items[0].metadata.name).toBe('Nhạc nền riêng');
    expect((await foreign.get(`${prefix}/music`)).body.items).toEqual([]);
    expect((await foreign.get(`${prefix}/media/${musicId}`)).status).toBe(404);
    const range = await owner.get(`${prefix}/media/${musicId}`).set('Range', 'bytes=0-15');
    expect(range.status).toBe(206); expect(range.headers['content-length']).toBe('16'); expect(range.headers['content-range']).toBe(`bytes 0-15/${wav.length}`);
    expect((await owner.get(`${prefix}/media/${musicId}`).set('Range', 'bytes=-0')).status).toBe(416);
    expect((await owner.get(`${prefix}/media/${musicId}`).set('Range', `bytes=${wav.length}-`)).status).toBe(416);
    const bad = Buffer.from(wav); bad.writeUInt16LE(3, 20);
    expect((await upload(owner, '/music', bad, 'audio/wav')).status).toBe(400);
    expect((await upload(viewer, '/music', wav, 'audio/wav')).status).toBe(403);
    expect((await upload(owner, '/backgrounds', Buffer.from('not an mp4'), 'video/mp4')).status).toBe(400);
  });

  it('decodes image names and evidence before validating length', async () => {
    const bytes = await readFile(new URL('../../../examples/source-capture/bea2a6e7cc6b44f3949640349012de1c.png', import.meta.url));
    const response = await upload(owner, '/backgrounds', bytes, 'image/png').set('X-Rights-Basis','LICENSED').set('X-Rights-Evidence',encodeURIComponent('Tác giả cho phép dùng trong video.'));
    expect(response.status).toBe(201);
    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: response.body.id as string } });
    expect(asset.metadata).toMatchObject({ name: 'Nhạc nền riêng' });
    expect(asset.rightsMetadata).toMatchObject({ evidence: 'Tác giả cho phép dùng trong video.' });
  });

  it('saves workspace presets with replay protection and rejects foreign assets and source data', async () => {
    const input = { name: 'Giọng & phụ đề của tôi', settings: { voiceProfileId: voiceId, subtitlePreset: 'KaraokeHighlight', mediaSettings: { musicAssetId: musicId, ducking: true } } };
    const key = randomUUID(); const response = await post(owner, '/studio-presets', input, key); expect(response.status).toBe(201);
    expect((await post(owner, '/studio-presets', input, key)).body).toEqual(response.body);
    expect((await post(owner, '/studio-presets', { ...input, name: 'Changed' }, key)).status).toBe(409);
    expect((await owner.get(`${prefix}/studio-presets`)).body.items).toHaveLength(1);
    expect((await viewer.get(`${prefix}/studio-presets`)).body.items).toHaveLength(1);
    expect((await foreign.get(`${prefix}/studio-presets`)).body.items).toEqual([]);
    expect((await post(foreign, '/studio-presets', input)).status).toBe(409);
    expect((await post(viewer, '/studio-presets', input)).status).toBe(403);
    expect((await post(owner, '/studio-presets', { ...input, settings: { ...input.settings, sourcePostId: randomUUID() } })).status).toBe(400);
    await db.mediaAsset.update({ where: { id: musicId }, data: { rightsMetadata: { attested: true, approved: false, basis: 'OWNED' } } });
    expect((await owner.get(`${prefix}/media/${musicId}`)).status).toBe(404);
    expect((await post(owner, '/studio-presets', input)).status).toBe(409);
  });
});
