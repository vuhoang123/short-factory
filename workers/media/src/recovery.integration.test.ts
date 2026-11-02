import { createHash, randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@shorts-factory/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMediaWorkerConfig } from './config.js';
import { relayMediaOutbox, type MediaEnvelope } from './outbox.js';
import { recoverMediaJobs } from './recovery.js';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Use a dedicated database ending in _test.');
const integration = testUrl && process.env.REDIS_URL ? describe.sequential : describe.skip;

integration('media recovery with PostgreSQL and an isolated BullMQ queue', () => {
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  let db: PrismaClient;
  beforeAll(() => { db = new PrismaClient({ datasourceUrl: testUrl }); });
  afterAll(async () => {
    if (!db) return;
    const scope = { workspaceId: { in: workspaceIds } };
    await db.$transaction([
      db.renderJob.deleteMany({ where: scope }), db.productionRun.deleteMany({ where: scope }), db.storyProject.deleteMany({ where: scope }),
      db.contentRight.deleteMany({ where: scope }), db.sourcePost.deleteMany({ where: scope }), db.contentChannel.deleteMany({ where: scope }),
      db.outboxEvent.deleteMany({ where: scope }), db.workspaceMember.deleteMany({ where: scope }),
      db.workspace.deleteMany({ where: { id: { in: workspaceIds } } }), db.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);
    await db.$disconnect();
  });

  async function fixture(status: 'QUEUED' | 'RUNNING' | 'CANCELLED' = 'QUEUED', lease: Date | null = null) {
    const key = randomUUID();
    const workspace = await db.workspace.create({ data: { name: 'Recovery synthetic fixture', slug: `recovery-${key}` } }); workspaceIds.push(workspace.id);
    const user = await db.user.create({ data: { email: `${key}@example.org`, passwordHash: 'disabled-test-login' } }); userIds.push(user.id);
    await db.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' } });
    const post = await db.sourcePost.create({ data: { workspaceId: workspace.id, platform: 'MANUAL', externalPostId: key, canonicalUrl: 'https://example.org/owned-fixture', body: 'Synthetic permitted local recovery fixture.', contentHash: createHash('sha256').update(key).digest('hex') } });
    const story = await db.storyProject.create({ data: { workspaceId: workspace.id, sourcePostId: post.id } });
    const run = await db.productionRun.create({ data: { workspaceId: workspace.id, storyProjectId: story.id, requestedById: user.id, idempotencyKey: key, input: {}, status, workerLeaseUntil: lease, attempts: 3 } });
    await db.renderJob.create({ data: { workspaceId: workspace.id, productionRunId: run.id, status } });
    const event = await db.outboxEvent.create({ data: { workspaceId: workspace.id, aggregateId: run.id, eventType: 'PRODUCTION_RUN_REQUESTED', payload: { entityId: run.id, workspaceId: workspace.id, version: 4 } } });
    return { workspace, run, event };
  }

  it('recovers a lost delivered job once across competing sweepers while preserving the explicit retry version', async () => {
    const f = await fixture();
    const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    const queue = new Queue<MediaEnvelope>(`media-recovery-${randomUUID()}`, { connection: redis });
    const config = readMediaWorkerConfig({ ...process.env, DATABASE_URL: testUrl, MEDIA_RETRY_ATTEMPTS: '3' });
    const now = new Date();
    try {
      expect(await relayMediaOutbox(db, queue, config)).toBeGreaterThanOrEqual(1);
      const job = await queue.getJob(f.event.id); expect(job?.data.version).toBe(4);
      await job!.remove();
      await db.outboxEvent.update({ where: { id: f.event.id }, data: { publishedAt: new Date(now.getTime() - 60_000) } });
      const counts = await Promise.all([recoverMediaJobs(db, queue, config, now), recoverMediaJobs(db, queue, config, now)]);
      expect(counts.reduce((total, count) => total + count, 0)).toBe(1);
      const recovered = await db.outboxEvent.findUniqueOrThrow({ where: { id: f.event.id } });
      expect(recovered.publishedAt).toBeNull(); expect(recovered.payload).toMatchObject({ version: 4, recoveryAttempts: 1 });
      expect(await db.outboxEvent.count({ where: { workspaceId: f.workspace.id, aggregateId: f.run.id } })).toBe(1);
      await relayMediaOutbox(db, queue, config);
      const restored = await queue.getJob(f.event.id); expect(restored?.data).toMatchObject({ version: 4, attempt: 1, workspaceId: f.workspace.id, entityId: f.run.id });
      const processor = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
      const eventsRedis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
      const events = new QueueEvents(queue.name, { connection: eventsRedis }); let deliveries = 0;
      const worker = new Worker<MediaEnvelope>(queue.name, async (next) => { if (next.data.jobId !== f.event.id) return 'unrelated'; deliveries += 1; await db.productionRun.updateMany({ where: { id: f.run.id, workspaceId: f.workspace.id, status: 'QUEUED' }, data: { status: 'SUCCEEDED', completedAt: new Date() } }); return 'restored'; }, { connection: processor });
      try { await Promise.all([events.waitUntilReady(), worker.waitUntilReady()]); expect(await restored!.waitUntilFinished(events, 10_000)).toBe('restored'); expect(deliveries).toBe(1); }
      finally { await worker.close(); await events.close(); await Promise.all([processor.quit(), eventsRedis.quit()]); }
      expect(await recoverMediaJobs(db, queue, config, new Date(now.getTime() + 60_000))).toBe(0);
    } finally { await queue.close(); await redis.quit(); }
  });

  it('keeps live leases, cancelled runs, and a forged cross-workspace event out of recovery', async () => {
    const now = new Date(); const live = await fixture('RUNNING', new Date(now.getTime() + 60_000)); const cancelled = await fixture('CANCELLED');
    const foreign = await db.outboxEvent.create({ data: { workspaceId: cancelled.workspace.id, aggregateId: live.run.id, eventType: 'PRODUCTION_RUN_REQUESTED', payload: { version: 1 }, publishedAt: new Date(now.getTime() - 60_000) } });
    await db.outboxEvent.updateMany({ where: { id: { in: [live.event.id, cancelled.event.id] } }, data: { publishedAt: new Date(now.getTime() - 60_000) } });
    const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 }); const queue = new Queue<MediaEnvelope>(`media-recovery-guard-${randomUUID()}`, { connection: redis });
    try {
      expect(await recoverMediaJobs(db, queue, readMediaWorkerConfig({ ...process.env, DATABASE_URL: testUrl }), now)).toBe(0);
      expect(await queue.getJob(foreign.id)).toBeUndefined();
      expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: foreign.id } })).publishedAt).not.toBeNull();
    } finally { await queue.close(); await redis.quit(); }
  });
});
