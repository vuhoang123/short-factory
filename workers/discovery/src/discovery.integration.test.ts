import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@shorts-factory/database';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readWorkerConfig } from './config.js';
import { relayPendingOutbox } from './outbox.js';
import { DiscoveryPipeline, type DiscoveryEnvelope } from './pipeline.js';
import { scheduleDueSources } from './scheduler.js';

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? describe.sequential : describe.skip;
const redisUrl = (() => {
  if (!process.env.REDIS_URL) return undefined;
  const url = new URL(process.env.REDIS_URL);
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.toString();
})();
let db: PrismaClient;
let workspaceId = '';

async function createFixture() {
  const workspace = await db.workspace.create({ data: { slug: `discovery-${randomUUID()}`, name: 'Discovery integration fixture' } });
  workspaceId = workspace.id;
  const channel = await db.contentChannel.create({ data: { workspaceId, name: 'Community', language: 'en', topicConfig: { keywords: ['community'] }, automationConfig: { enabled: false }, minimumCandidateScore: 55 } });
  const source = await db.sourceConfig.create({ data: { workspaceId, channelId: channel.id, platform: 'MANUAL', sourceKey: 'synthetic-demo', enabled: true, capabilityStatus: 'AVAILABLE', config: { mode: 'MOCK_FIXTURE', keywords: [], hashtags: [], topics: [], language: 'en', retainRawPayload: false }, nextSyncAt: new Date() } });
  return { channel, source };
}

async function cleanFixture() {
  if (!workspaceId) return;
  await db.contentCandidate.deleteMany({ where: { workspaceId } });
  await db.contentRight.deleteMany({ where: { workspaceId } });
  await db.sourceComment.deleteMany({ where: { workspaceId } });
  await db.postMetricSnapshot.deleteMany({ where: { workspaceId } });
  await db.sourcePost.deleteMany({ where: { workspaceId } });
  await db.sourceSyncRun.deleteMany({ where: { workspaceId } });
  await db.sourceConfig.deleteMany({ where: { workspaceId } });
  await db.topicRule.deleteMany({ where: { workspaceId } });
  await db.contentChannel.deleteMany({ where: { workspaceId } });
  await db.outboxEvent.deleteMany({ where: { workspaceId } });
  await db.auditLog.deleteMany({ where: { workspaceId } });
  await db.workspace.delete({ where: { id: workspaceId } });
  workspaceId = '';
}

integration('discovery worker PostgreSQL and BullMQ vertical slice', () => {
  beforeAll(() => { db = new PrismaClient({ datasourceUrl: testUrl ?? '' }); });
  afterAll(async () => { if (db) await db.$disconnect(); });

  it('schedules only due mock sources and commits a run with its outbox event', async () => {
    const { source } = await createFixture();
    await db.sourceConfig.update({ where: { workspaceId_id: { workspaceId, id: source.id } }, data: { nextSyncAt: new Date(Date.now() - 60_000) } });
    expect(await scheduleDueSources(db, 10)).toBe(1);
    const run = await db.sourceSyncRun.findFirstOrThrow({ where: { workspaceId, sourceConfigId: source.id } });
    expect(run.status).toBe('QUEUED');
    expect(run.idempotencyKey).toMatch(/^schedule:/);
    expect(await db.outboxEvent.count({ where: { workspaceId, eventType: 'SOURCE_SYNC_REQUESTED', aggregateId: run.id, publishedAt: null } })).toBe(1);
    expect(await scheduleDueSources(db, 10)).toBe(0);
  });

  if (redisUrl) it('relays the outbox to BullMQ and discovers, normalizes, deduplicates, scores and persists rights-held candidates', async () => {
    const { source } = await createFixture();
    const run = await db.sourceSyncRun.create({ data: { workspaceId, sourceConfigId: source.id, status: 'QUEUED', idempotencyKey: randomUUID() } });
    const event = await db.outboxEvent.create({ data: { workspaceId, eventType: 'SOURCE_SYNC_REQUESTED', aggregateId: run.id, payload: { entityId: run.id, workspaceId, version: 1 } } });
    const config = readWorkerConfig({ ...process.env, DATABASE_URL: testUrl ?? '', REDIS_URL: redisUrl, DISCOVERY_PAGE_SIZE: '2', DISCOVERY_MAX_PAGES: '1', DISCOVERY_PAGE_DELAY_MS: '0', DISCOVERY_COMMENT_LIMIT: '10', DISCOVERY_RETRY_DELAY_MS: '100' });
    const queueName = `discovery-e2e-${randomUUID()}`;
    const producer = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
    const processor = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const eventsConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue<DiscoveryEnvelope>(queueName, { connection: producer });
    const events = new QueueEvents(queueName, { connection: eventsConnection });
    const pipeline = new DiscoveryPipeline(db, config);
    const worker = new Worker<DiscoveryEnvelope>(queueName, async job => {
      await pipeline.process(job.data, job.attemptsMade, Number(job.opts.attempts ?? config.DISCOVERY_RETRY_ATTEMPTS));
      return { status: 'SUCCEEDED' };
    }, { connection: processor, concurrency: 1 });
    try {
      await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
      async function processEvent(eventId: string) {
        expect(await relayPendingOutbox(db, queue, config, workspaceId)).toBe(1);
        expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).publishedAt).not.toBeNull();
        const job = await queue.getJob(eventId);
        expect(job).toBeTruthy();
        expect(await job!.waitUntilFinished(events, 20_000)).toMatchObject({ status: 'SUCCEEDED' });
      }
      async function enqueueRun(runId: string) {
        const nextEvent = await db.outboxEvent.create({ data: { workspaceId, eventType: 'SOURCE_SYNC_REQUESTED', aggregateId: runId, payload: { entityId: runId, workspaceId, version: 1 } } });
        await processEvent(nextEvent.id);
      }
      await processEvent(event.id);
      const completed = await db.sourceSyncRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(completed).toMatchObject({ status: 'PARTIAL', fetchedCount: 2, duplicateCount: 0, nextCursor: '2' });
      expect(await db.sourcePost.count({ where: { workspaceId } })).toBe(2);
      expect(await db.sourceComment.count({ where: { workspaceId } })).toBe(5);

      await db.sourceConfig.update({ where: { workspaceId_id: { workspaceId, id: source.id } }, data: { nextSyncAt: new Date(Date.now() - 60_000) } });
      expect(await scheduleDueSources(db, 10)).toBe(1);
      const continuation = await db.sourceSyncRun.findFirstOrThrow({ where: { workspaceId, sourceConfigId: source.id, status: 'QUEUED' }, orderBy: { startedAt: 'desc' } });
      expect(continuation.cursor).toBe('2');
      const continuationEvent = await db.outboxEvent.findFirstOrThrow({ where: { workspaceId, aggregateId: continuation.id } });
      await processEvent(continuationEvent.id);
      expect(await db.sourceSyncRun.findUniqueOrThrow({ where: { id: continuation.id } })).toMatchObject({ status: 'SUCCEEDED', fetchedCount: 1, duplicateCount: 0 });
      expect(await db.sourcePost.count({ where: { workspaceId } })).toBe(3);
      expect(await db.sourceComment.count({ where: { workspaceId } })).toBe(7);
      expect(await db.postMetricSnapshot.count({ where: { workspaceId } })).toBe(3);
      expect(await db.contentRight.count({ where: { workspaceId, basis: 'UNKNOWN', reviewStatus: 'PENDING' } })).toBe(3);
      const posts = await db.sourcePost.findMany({ where: { workspaceId }, include: { candidates: true } });
      expect(posts.every(post => post.synthetic && post.rawPayload === null && post.candidates.length === 1 && post.candidates[0]?.score !== null && post.candidates[0]?.status === 'NEEDS_RIGHTS_REVIEW')).toBe(true);

      const repeat = await db.sourceSyncRun.create({ data: { workspaceId, sourceConfigId: source.id, status: 'QUEUED', idempotencyKey: randomUUID() } });
      await enqueueRun(repeat.id);
      expect(await db.sourceSyncRun.findUniqueOrThrow({ where: { id: repeat.id } })).toMatchObject({ status: 'PARTIAL', duplicateCount: 2, nextCursor: '2' });
      await db.sourceConfig.update({ where: { workspaceId_id: { workspaceId, id: source.id } }, data: { nextSyncAt: new Date(Date.now() - 60_000) } });
      expect(await scheduleDueSources(db, 10)).toBe(1);
      const repeatContinuation = await db.sourceSyncRun.findFirstOrThrow({ where: { workspaceId, sourceConfigId: source.id, status: 'QUEUED' }, orderBy: { startedAt: 'desc' } });
      expect(repeatContinuation.cursor).toBe('2');
      const repeatContinuationEvent = await db.outboxEvent.findFirstOrThrow({ where: { workspaceId, aggregateId: repeatContinuation.id } });
      await processEvent(repeatContinuationEvent.id);
      expect(await db.sourceSyncRun.findUniqueOrThrow({ where: { id: repeatContinuation.id } })).toMatchObject({ status: 'SUCCEEDED', duplicateCount: 1 });
      expect(await db.sourcePost.count({ where: { workspaceId } })).toBe(3);
    } finally {
      await worker.close(); await events.close(); await queue.close();
      await Promise.all([producer.quit(), processor.quit(), eventsConnection.quit()]);
    }
  });

  if (redisUrl) it('retries a failed BullMQ job with the configured attempt policy', async () => {
    const queueName = `discovery-retry-${randomUUID()}`;
    const producer = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
    const processor = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const eventsConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue<{ value: boolean }, string>(queueName, { connection: producer });
    const events = new QueueEvents(queueName, { connection: eventsConnection });
    let attempts = 0;
    const worker = new Worker<{ value: boolean }, string>(queueName, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('TRANSIENT_TEST_ERROR');
      return 'recovered';
    }, { connection: processor, concurrency: 1 });
    try {
      await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
      const job = await queue.add('retry-policy-test', { value: true }, { attempts: 2, backoff: { type: 'fixed', delay: 50 }, removeOnComplete: true });
      expect(await job.waitUntilFinished(events, 15_000)).toBe('recovered');
      expect(attempts).toBe(2);
    } finally {
      await worker.close(); await events.close(); await queue.close();
      await Promise.all([producer.quit(), processor.quit(), eventsConnection.quit()]);
    }
  });

  afterEach(async () => { await cleanFixture(); });
});

