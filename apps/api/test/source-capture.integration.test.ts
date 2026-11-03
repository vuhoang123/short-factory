import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@shorts-factory/database';
import * as sources from '@shorts-factory/sources';
import { productionInputSchema } from '@shorts-factory/media';
import fixture from '../../../examples/source-capture/capture.json';
import { createApp } from '../src/app.js';
import { processLocalCapture, purgeCurrentBrowserCapture, recoverLocalCaptures } from '../../../workers/discovery/src/local-capture.js';
import { DiscoveryPipeline } from '../../../workers/discovery/src/pipeline.js';
import { readWorkerConfig } from '../../../workers/discovery/src/config.js';

const integration = process.env.TEST_DATABASE_URL ? describe.sequential : describe.skip;
integration('user-assisted source capture: PostgreSQL and mocked browser bridge', () => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  let app: INestApplication;
  let owner: ReturnType<typeof supertest.agent>;
  let outsider: ReturnType<typeof supertest.agent>;
  const workspaces: string[] = [], users: string[] = [];
  let workspaceId = '', channelId = '', captureId = '', sourcePostId = '', candidateId = '';
  let imageId = '';
  const origin = process.env.APP_URL ?? 'http://localhost:3000';
  const post = (path: string, body: object, key = randomUUID()) => owner.post(`/api/v1${path}`).set('Origin', origin).set('Idempotency-Key', key).send(body);
  beforeAll(async () => {
    vi.stubEnv('LOCAL_CAPTURE_ENABLED', '1');
    vi.stubEnv('TTS_PROVIDER', 'mock');
    app = await createApp(db); await app.init(); owner = supertest.agent(app.getHttpServer()); outsider = supertest.agent(app.getHttpServer());
    for (const [i, agent] of [owner, outsider].entries()) {
      const result = await agent.post('/api/v1/auth/register').set('Origin', origin).set('Idempotency-Key', randomUUID()).send({ email: `capture-${randomUUID()}-${i}@example.org`, password: 'Testing-source-capture-2026!', name: 'Capture fixture' });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      const workspace = await agent.post('/api/v1/workspaces').set('Origin', origin).set('Idempotency-Key', randomUUID()).send({ name: 'Capture fixture', slug: `capture-${randomUUID()}` });
      expect(workspace.status).toBe(201);
      const session = (await agent.get('/api/v1/auth/me')).body;
      users.push(session.user.id as string); workspaces.push(session.activeWorkspaceId as string);
    }
    workspaceId = workspaces[0]!;
    const channel = await post('/channels', { name: 'Owned capture fixture', language: 'vi', minimumCandidateScore: 0 });
    expect(channel.status).toBe(201); channelId = channel.body.id as string;
    vi.spyOn(sources, 'localCaptureCall').mockImplementation(async (action, input) => {
      if (action === 'capture') return Response.json(fixture);
      if (action === 'image') return new Response(new Uint8Array(await readFile(new URL(`../../../examples/source-capture/${input.imageId}.png`, import.meta.url))), { headers: { 'Content-Type': 'image/png' } });
      return Response.json({ ok: true });
    });
  });
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    for (const workspaceId of workspaces) {
      await db.contentRight.deleteMany({ where: { workspaceId } });
      await db.workspace.delete({ where: { id: workspaceId } });
    }
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect(); if (app) await app.close();
  });
  it('queues atomically with idempotency, owner-only status, and no client-selected workspace', async () => {
    const body = { url: fixture.url, channelId }, key = randomUUID();
    const first = await post('/source-captures', body, key);
    expect(first.status).toBe(201); captureId = first.body.id as string;
    expect((await post('/source-captures', body, key)).body).toEqual(first.body);
    expect(await db.outboxEvent.count({ where: { workspaceId, aggregateId: captureId, eventType: 'BROWSER_CAPTURE_REQUESTED' } })).toBe(1);
    expect((await outsider.get(`/api/v1/source-captures/${captureId}`)).status).toBe(404);
    expect((await owner.get(`/api/v1/source-captures/${captureId}`)).body.browserRequest).toBeNull();
    expect((await post('/source-captures', { ...body, workspaceId: workspaces[1] })).status).toBe(400);
    expect((await post('/source-captures', body)).status).toBe(409);
  });
  it('persists exact post/comment screenshots, reaction counts and unknown rights, once', async () => {
    await processLocalCapture(db, workspaceId, captureId);
    const run = await db.workflowRun.findUniqueOrThrow({ where: { id: captureId } });
    expect(run.status).toBe('SUCCEEDED'); sourcePostId = run.entityId;
    const stored = await db.sourcePost.findUniqueOrThrow({ where: { id: sourcePostId }, include: { comments: true, rights: true } });
    expect(stored.body).toBe(fixture.text); expect(stored.comments).toHaveLength(5);
    expect(stored.comments.map(comment => comment.likes).sort()).toEqual([100, 60, 70, 80, 90]);
    expect(stored.rights[0]).toMatchObject({ basis: 'UNKNOWN', reviewStatus: 'PENDING', attested: false });
    const images = (await owner.get(`/api/v1/posts/${sourcePostId}/source-images`)).body.items as Array<{ id: string }>;
    expect(images).toHaveLength(12); imageId = images[0]!.id;
    expect((await owner.get(`/api/v1/media/${imageId}`)).status).toBe(200);
    expect((await outsider.get(`/api/v1/posts/${sourcePostId}/source-images`)).status).toBe(404);
    expect((await outsider.get(`/api/v1/media/${imageId}`)).status).toBe(404);
    await processLocalCapture(db, workspaceId, captureId);
    expect(await db.mediaAsset.count({ where: { workspaceId, kind: 'SOURCE_CAPTURE' } })).toBe(12);
    const pipeline = new DiscoveryPipeline(db, readWorkerConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL, REDIS_URL: 'redis://localhost' }));
    await pipeline.process({ jobId: randomUUID(), workspaceId, entityId: sourcePostId, step: 'SOURCE_POST_IMPORTED', version: 1, idempotencyKey: randomUUID(), traceId: randomUUID(), attempt: 0, scheduledAt: new Date().toISOString() });
    candidateId = (await db.contentCandidate.findFirstOrThrow({ where: { workspaceId, sourcePostId } })).id;
    expect((await post(`/candidates/${candidateId}/produce`, { channelId, voiceProfileId: 'mock:default' })).status).toBe(409);
  });
  it('freezes verified anonymized image identities only after explicit rights and source review', async () => {
    expect((await post(`/posts/${sourcePostId}/rights/review`, { decision: 'APPROVED', basis: 'OWNED', evidence: 'Original synthetic HTML authored by this project for tests.', attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], territory: 'WORLDWIDE' })).status).toBe(201);
    expect((await post(`/candidates/${candidateId}/review`, { decision: 'APPROVED' })).status).toBe(201);
    const request = { channelId, voiceProfileId: 'mock:default', draftOnly: true, commentSelection: 'TOP_REACTIONS' };
    const produced = await post(`/candidates/${candidateId}/produce`, request);
    expect(produced.status, JSON.stringify(produced.body)).toBe(201);
    const run = await db.productionRun.findUniqueOrThrow({ where: { id: produced.body.runId as string } });
    const input = productionInputSchema.parse(run.input);
    expect(input.sourceImages).toHaveLength(6); expect(input.sourceImages!.every(image => image.anonymized)).toBe(true);
    const missing = await db.mediaAsset.findFirstOrThrow({ where: { workspaceId, kind: 'SOURCE_CAPTURE', metadata: { path: ['sourceRef'], equals: `post:${sourcePostId}` }, AND: [{ metadata: { path: ['variant'], equals: 'ANONYMIZED' } }] } });
    await db.mediaAsset.delete({ where: { id: missing.id } });
    const blocked = await post(`/candidates/${candidateId}/produce`, request);
    expect(blocked.status).toBe(409); expect(blocked.body.code).toBe('SOURCE_IMAGE_ANONYMIZATION_REQUIRED');
  });
  it('fences cancellation and recovers an expired lease through a fresh durable outbox event', async () => {
    const created = await post('/source-captures', { channelId, url: 'https://www.threads.com/@fixture/post/NEW' });
    const id = created.body.id as string; expect(created.status).toBe(201);
    await db.workflowRun.update({ where: { id }, data: { status: 'RUNNING', leaseUntil: new Date(Date.now() - 1000), updatedAt: new Date(Date.now() - 60000), attempts: 1 } });
    await recoverLocalCaptures(db);
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id } })).status).toBe('QUEUED');
    expect(await db.outboxEvent.count({ where: { workspaceId, aggregateId: id, eventType: 'BROWSER_CAPTURE_REQUESTED' } })).toBe(2);
    expect((await post(`/source-captures/${id}/cancel`, {})).body.status).toBe('CANCELLED');
    await processLocalCapture(db, workspaceId, id);
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
  });
  it('takedown removes screenshot access and capture results with the existing media deletion outbox', async () => {
    const result = await post('/takedowns', { postId: sourcePostId, reason: 'Remove owned test content' });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect((await owner.get(`/api/v1/media/${imageId}`)).status).toBe(404);
    expect((await owner.get(`/api/v1/source-captures/${captureId}`)).status).toBe(404);
    expect(await db.mediaAsset.count({ where: { workspaceId, kind: 'SOURCE_CAPTURE' } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { workspaceId, eventType: 'MEDIA_ASSET_DELETE_REQUESTED' } })).toBeGreaterThan(0);
  });
  it('receives current-browser PNGs without invoking the dedicated browser, freezes once and removes the inbox', async () => {
    const workspace = await post('/workspaces', { name: 'Current browser capture fixture', slug: `capture-current-${randomUUID()}` });
    expect(workspace.status).toBe(201); workspaceId = workspace.body.id as string; workspaces.push(workspaceId);
    const channel = await post('/channels', { name: 'Current browser fixture', language: 'vi', minimumCandidateScore: 0 }); channelId = channel.body.id as string;
    const body = { url: fixture.url, channelId, browser: 'CURRENT' }, key = randomUUID();
    const created = await post('/source-captures', body, key);
    expect(created.status).toBe(201); expect(created.body.status).toBe('WAITING_BROWSER');
    const id = created.body.id as string;
    expect((await owner.get(`/api/v1/source-captures/${id}`)).body.browserRequest).toEqual({ url: fixture.url });
    expect((await outsider.get(`/api/v1/source-captures/${id}`)).status).toBe(404);
    expect((await post('/source-captures', body, key)).body).toEqual(created.body);
    expect(await db.outboxEvent.count({ where: { workspaceId, aggregateId: id, eventType: 'BROWSER_CAPTURE_REQUESTED' } })).toBe(0);
    const entries = [fixture, ...fixture.comments];
    for (const entry of entries) for (const imageId of [entry.source_image_id, entry.anonymous_image_id]) {
      const bytes = await readFile(new URL(`../../../examples/source-capture/${imageId}.png`, import.meta.url));
      const route = `/api/v1/source-captures/${id}/images/${imageId}`, uploadKey = randomUUID();
      const upload = () => owner.post(route).set('Origin', origin).set('Idempotency-Key', uploadKey).set('Content-Type', 'image/png').send(bytes);
      expect((await upload()).status).toBe(201); expect((await upload()).status).toBe(201);
      expect((await outsider.post(route).set('Origin', origin).set('Idempotency-Key', randomUUID()).set('Content-Type', 'image/png').send(bytes)).status).toBe(404);
    }
    const upload = await db.mediaAsset.findFirstOrThrow({ where: { workspaceId, kind: 'SOURCE_CAPTURE_UPLOAD', metadata: { path: ['captureRunId'], equals: id } } });
    expect((await owner.get(`/api/v1/media/${upload.id}`)).status).toBe(404);
    expect((await post(`/source-captures/${id}/result`, { post: { ...fixture, url: 'https://www.facebook.com/other/posts/wrong' } })).status).toBe(400);
    expect((await post(`/source-captures/${id}/result`, { post: { ...fixture, source_image_id: 'f'.repeat(32) } })).status).toBe(409);
    const snapshot = { post: fixture }, resultKey = randomUUID();
    const completed = await post(`/source-captures/${id}/result`, snapshot, resultKey);
    expect(completed.body).toMatchObject({ id, status: 'QUEUED' });
    expect((await post(`/source-captures/${id}/result`, snapshot, resultKey)).body).toEqual(completed.body);
    expect((await owner.get(`/api/v1/source-captures/${id}`)).body.output).toBeNull();
    expect((await owner.get(`/api/v1/source-captures/${id}`)).body.browserRequest).toBeNull();
    expect(await db.outboxEvent.count({ where: { workspaceId, aggregateId: id, eventType: 'BROWSER_CAPTURE_REQUESTED' } })).toBe(1);
    const calls = vi.mocked(sources.localCaptureCall).mock.calls.length;
    await processLocalCapture(db, workspaceId, id);
    expect(vi.mocked(sources.localCaptureCall).mock.calls).toHaveLength(calls);
    const run = await db.workflowRun.findUniqueOrThrow({ where: { id } });
    expect(run.status, run.errorCode ?? '').toBe('SUCCEEDED');
    expect((await owner.get(`/api/v1/posts/${run.entityId}/source-images`)).body.items).toHaveLength(12);
    expect((await post('/takedowns', { postId: run.entityId, reason: 'Test removal before capture-inbox cleanup delivery' })).status).toBe(201);
    expect(await purgeCurrentBrowserCapture(db, workspaceId, users[0]!, id)).toBe(false);
    expect(await db.mediaAsset.count({ where: { workspaceId, kind: 'SOURCE_CAPTURE_UPLOAD', metadata: { path: ['captureRunId'], equals: id } } })).toBe(0);
    expect((await db.contentRight.findFirstOrThrow({ where: { workspaceId, sourcePostId: run.entityId } })).basis).toBe('UNKNOWN');
  });
  it('expires and cancels pending current-browser jobs, denying further images and result writes', async () => {
    const created = await post('/source-captures', { url: fixture.url, channelId, browser: 'CURRENT' });
    const id = created.body.id as string;
    const bytes = await readFile(new URL(`../../../examples/source-capture/${fixture.source_image_id}.png`, import.meta.url));
    const upload = () => owner.post(`/api/v1/source-captures/${id}/images/${fixture.source_image_id}`).set('Origin', origin).set('Idempotency-Key', randomUUID()).set('Content-Type', 'image/png').send(bytes);
    expect((await upload()).status).toBe(201);
    expect((await post(`/source-captures/${id}/cancel`, {})).body.status).toBe('CANCELLED');
    expect((await owner.get(`/api/v1/source-captures/${id}`)).body.browserRequest).toBeNull();
    expect((await upload()).status).toBe(409);
    expect((await post(`/source-captures/${id}/result`, { post: fixture })).status).toBe(409);
    await purgeCurrentBrowserCapture(db, workspaceId, users[0]!, id);
    const pending = await post('/source-captures', { url: fixture.url, channelId, browser: 'CURRENT' });
    const expiredId = pending.body.id as string;
    await db.workflowRun.update({ where: { id: expiredId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    expect((await owner.get(`/api/v1/source-captures/${expiredId}`)).body.browserRequest).toBeNull();
    await recoverLocalCaptures(db);
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: expiredId } })).status).toBe('FAILED');
    expect(await db.outboxEvent.count({ where: { workspaceId, aggregateId: expiredId, eventType: 'LOCAL_CAPTURE_PURGE_REQUESTED' } })).toBe(1);
  });
});
