import { createHash, randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@shorts-factory/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readWorkerConfig } from './config.js';
import { relayPendingOutbox } from './outbox.js';
import { DiscoveryPipeline, type DiscoveryEnvelope } from './pipeline.js';
import { recoverDiscoveryJobs } from './recovery.js';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Use a dedicated database ending in _test.');
const integration = testUrl && process.env.REDIS_URL ? describe.sequential : describe.skip;

integration('manual import recovery with PostgreSQL and isolated Redis delivery', () => {
  let db: PrismaClient; const workspaceIds: string[] = [];
  beforeAll(() => { db = new PrismaClient({ datasourceUrl: testUrl }); });
  afterAll(async () => {
    if (!db) return; const scope = { workspaceId: { in: workspaceIds } };
    await db.$transaction([db.contentCandidate.deleteMany({ where: scope }), db.contentRight.deleteMany({ where: scope }), db.sourcePost.deleteMany({ where: scope }), db.contentChannel.deleteMany({ where: scope }), db.outboxEvent.deleteMany({ where: scope }), db.workspace.deleteMany({ where: { id: { in: workspaceIds } } })]);
    await db.$disconnect();
  });
  it('rescores the missing candidate after a delivered Redis job disappears without creating a duplicate event', async () => {
    const key = randomUUID(); const workspace = await db.workspace.create({ data: { name: 'Manual recovery test', slug: `manual-recovery-${key}` } }); workspaceIds.push(workspace.id);
    const post = await db.sourcePost.create({ data: { workspaceId: workspace.id, platform: 'MANUAL', externalPostId: key, canonicalUrl: 'https://example.org/owned-story', body: 'A permitted community story for the local export workflow.', contentHash: createHash('sha256').update(key).digest('hex') } });
    const event = await db.outboxEvent.create({ data: { workspaceId: workspace.id, aggregateId: post.id, eventType: 'SOURCE_POST_IMPORTED', payload: { entityId: post.id, workspaceId: workspace.id, version: 1 } } });
    const config = readWorkerConfig({ ...process.env, DATABASE_URL: testUrl });
    const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 }); const queue = new Queue<DiscoveryEnvelope>(`manual-recovery-${key}`, { connection: redis });
    try {
      expect(await relayPendingOutbox(db, queue, config, workspace.id)).toBe(1);
      await (await queue.getJob(event.id))!.remove();
      const now = new Date(); await db.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date(now.getTime() - 60_000) } });
      expect(await recoverDiscoveryJobs(db, queue, config, now)).toBe(1);
      expect(await recoverDiscoveryJobs(db, queue, config, now)).toBe(0);
      expect(await db.outboxEvent.count({ where: { workspaceId: workspace.id, aggregateId: post.id } })).toBe(1);
      await relayPendingOutbox(db, queue, config, workspace.id);
      const restored = await queue.getJob(event.id); expect(restored?.data.attempt).toBe(1);
      const processor = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }); const eventsRedis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
      const events = new QueueEvents(queue.name, { connection: eventsRedis }); const pipeline = new DiscoveryPipeline(db, config);
      const worker = new Worker<DiscoveryEnvelope>(queue.name, async (job) => { await pipeline.process(job.data); return 'scored'; }, { connection: processor });
      try { await Promise.all([events.waitUntilReady(), worker.waitUntilReady()]); expect(await restored!.waitUntilFinished(events, 10_000)).toBe('scored'); }
      finally { await worker.close(); await events.close(); await Promise.all([processor.quit(), eventsRedis.quit()]); }
      expect(await db.contentCandidate.count({ where: { workspaceId: workspace.id, sourcePostId: post.id } })).toBe(1);
      expect(await recoverDiscoveryJobs(db, queue, config, new Date(now.getTime() + 60_000))).toBe(0);
    } finally { await queue.close(); await redis.quit(); }
  });
});
