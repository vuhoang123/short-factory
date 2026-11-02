import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@shorts-factory/database';
import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { readWorkerConfig } from './config.js';
import { recoverDiscoveryJobs } from './recovery.js';
import type { DiscoveryEnvelope } from './pipeline.js';

function fixture(eventType = 'SOURCE_POST_IMPORTED', recoveryAttempts = 0) {
  const now = new Date();
  const event = { id: randomUUID(), workspaceId: randomUUID(), aggregateId: randomUUID(), eventType, publishedAt: new Date(now.getTime() - 60_000), payload: { version: 1, recoveryAttempts } };
  const outboxEvent = { findFirst: vi.fn(async () => event), updateMany: vi.fn(async () => ({ count: 1 })) };
  const sourcePost = { findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: event.aggregateId })) };
  const sourceSyncRun = { findFirst: vi.fn(async () => ({ id: event.aggregateId, status: 'QUEUED', attempts: 0 })), updateMany: vi.fn(async () => ({ count: 1 })) };
  const tx = { $queryRaw: vi.fn(async () => [{ id: event.id }]), outboxEvent, sourcePost, sourceSyncRun, auditLog: { create: vi.fn(async () => ({})) } };
  const db = { $queryRaw: vi.fn(async () => [event]), $transaction: vi.fn(async (work: (client: typeof tx) => Promise<number>) => work(tx)) } as unknown as PrismaClient;
  const getJob = vi.fn(async (): Promise<undefined | { getState: () => Promise<string>; remove: () => Promise<void> }> => undefined);
  const queue = { getJob } as unknown as Queue<DiscoveryEnvelope>;
  const config = readWorkerConfig({ DATABASE_URL: 'postgresql://localhost/unused_test', REDIS_URL: 'redis://localhost' });
  return { now, event, outboxEvent, sourcePost, sourceSyncRun, tx, db, getJob, queue, config };
}

describe('local discovery delivery recovery', () => {
  it('recovers a delivered manual-import event only for a live tenant post without a candidate', async () => {
    const f = fixture();
    expect(await recoverDiscoveryJobs(f.db, f.queue, f.config, f.now)).toBe(1);
    expect(f.sourcePost.findFirst).toHaveBeenCalledWith({ where: { id: f.event.aggregateId, workspaceId: f.event.workspaceId, deletedAt: null, candidates: { none: {} } }, select: { id: true } });
    expect(f.outboxEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { publishedAt: null, payload: { version: 1, recoveryAttempts: 1 } } }));
    f.sourcePost.findFirst.mockResolvedValue(null);
    expect(await recoverDiscoveryJobs(f.db, f.queue, f.config, f.now)).toBe(0);
  });

  it('does not touch live queue jobs or reclaim a running synthetic sync without a lease', async () => {
    const f = fixture(); f.getJob.mockResolvedValue({ getState: async () => 'active', remove: vi.fn(async () => undefined) });
    expect(await recoverDiscoveryJobs(f.db, f.queue, f.config, f.now)).toBe(0);
    const sync = fixture('SOURCE_SYNC_REQUESTED'); sync.sourceSyncRun.findFirst.mockResolvedValue({ id: sync.event.aggregateId, status: 'RUNNING', attempts: 1 });
    expect(await recoverDiscoveryJobs(sync.db, sync.queue, sync.config, sync.now)).toBe(0);
  });

  it('never reopens an event after its durable recovery budget is exhausted', async () => {
    const f = fixture('SOURCE_POST_IMPORTED', 5);
    expect(await recoverDiscoveryJobs(f.db, f.queue, f.config, f.now)).toBe(0);
    expect(f.outboxEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { payload: { version: 1, recoveryAttempts: 5, recoveryExhausted: true, recoveryCheckedAt: f.now.toISOString() } } }));
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'DISCOVERY_RECOVERY_EXHAUSTED', workspaceId: f.event.workspaceId, resourceId: f.event.aggregateId }) }));
  });
});
