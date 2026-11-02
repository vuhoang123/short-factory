import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@shorts-factory/database';
import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { readMediaWorkerConfig } from './config.js';
import { recoverMediaJobs } from './recovery.js';
import type { MediaEnvelope } from './outbox.js';

function fixture(status = 'QUEUED', recoveryAttempts = 0) {
  const now = new Date();
  const event = { id: randomUUID(), workspaceId: randomUUID(), aggregateId: randomUUID(), eventType: 'PRODUCTION_RUN_REQUESTED', publishedAt: new Date(now.getTime() - 60_000), payload: { version: 4, recoveryAttempts } };
  const run = { id: event.aggregateId, workspaceId: event.workspaceId, status, attempts: 3, workerLeaseUntil: null as Date | null };
  const outbox = { findFirst: vi.fn(async () => event), updateMany: vi.fn(async () => ({ count: 1 })) };
  const productionRun = { findFirst: vi.fn(async () => run), updateMany: vi.fn(async () => ({ count: 1 })) };
  const renderJob = { updateMany: vi.fn(async () => ({ count: 1 })) };
  const tx = { $queryRaw: vi.fn(async () => [{ id: event.id }]), outboxEvent: outbox, productionRun, renderJob };
  const db = { $queryRaw: vi.fn(async () => [event]), $transaction: vi.fn(async (work: (client: typeof tx) => Promise<number>) => work(tx)) } as unknown as PrismaClient;
  const getJob = vi.fn(async (): Promise<undefined | { getState: () => Promise<string>; remove: () => Promise<void> }> => undefined);
  const queue = { getJob } as unknown as Queue<MediaEnvelope>;
  const config = readMediaWorkerConfig({ DATABASE_URL: 'postgresql://localhost/unused_test', REDIS_URL: 'redis://localhost', MEDIA_RETRY_ATTEMPTS: '3' });
  return { now, event, run, outbox, productionRun, renderJob, tx, db, getJob, queue, config };
}

describe('PostgreSQL media delivery recovery', () => {
  it('reopens the same durable outbox event with a persisted bounded recovery count', async () => {
    const f = fixture();
    expect(await recoverMediaJobs(f.db, f.queue, f.config, f.now)).toBe(1);
    expect(f.outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: f.event.id, workspaceId: f.event.workspaceId, publishedAt: f.event.publishedAt },
      data: { publishedAt: null, payload: { version: 4, recoveryAttempts: 1 } },
    }));
    expect(f.productionRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: f.event.workspaceId, attempts: 3 }), data: expect.objectContaining({ status: 'QUEUED' }) }));
  });

  it.each(['active', 'waiting', 'delayed', 'waiting-children', 'paused'])('preserves a %s BullMQ job', async (state) => {
    const f = fixture(); const remove = vi.fn(async () => undefined);
    f.getJob.mockResolvedValue({ getState: async () => state, remove });
    expect(await recoverMediaJobs(f.db, f.queue, f.config, f.now)).toBe(0);
    expect(remove).not.toHaveBeenCalled();
    expect(f.outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { payload: { version: 4, recoveryAttempts: 0, recoveryCheckedAt: f.now.toISOString() } } }));
    expect(f.productionRun.updateMany).not.toHaveBeenCalled();
  });

  it.each(['SUCCEEDED', 'CANCELLED', 'BLOCKED_RIGHTS', 'BLOCKED_EXTERNAL', 'FAILED_PERMANENT'])('never revives %s or a live worker lease', async (status) => {
    const f = fixture(status);
    expect(await recoverMediaJobs(f.db, f.queue, f.config, f.now)).toBe(0);
    expect(f.outbox.updateMany).not.toHaveBeenCalled();
    f.run.status = 'RUNNING'; f.run.workerLeaseUntil = new Date(f.now.getTime() + 60_000);
    expect(await recoverMediaJobs(f.db, f.queue, f.config, f.now)).toBe(0);
  });

  it('settles exhausted delivery recovery instead of retrying forever', async () => {
    const f = fixture('QUEUED', 3);
    expect(await recoverMediaJobs(f.db, f.queue, f.config, f.now)).toBe(0);
    expect(f.productionRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED_PERMANENT', errorCode: 'QUEUE_RECOVERY_EXHAUSTED' }) }));
    expect(f.outbox.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing when another sweeper already owns the outbox row', async () => {
    const f = fixture(); f.tx.$queryRaw.mockResolvedValue([]);
    expect(await recoverMediaJobs(f.db, f.queue, f.config, f.now)).toBe(0);
    expect(f.getJob).not.toHaveBeenCalled(); expect(f.outbox.updateMany).not.toHaveBeenCalled();
  });
});

it('defers a competing serializable recovery to the next sweep and propagates other DB failures', async () => {
  const config = readMediaWorkerConfig({ DATABASE_URL: 'postgresql://localhost/unused_test', REDIS_URL: 'redis://localhost' });
  const transaction = vi.fn();
  const db = { $queryRaw: vi.fn(async () => [{ id: 'event', workspaceId: 'workspace' }]), $transaction: transaction } as unknown as PrismaClient;
  const queue = {} as Queue<MediaEnvelope>;
  for (const failure of [new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }), new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2010', clientVersion: 'test', meta: { code: '40001' } })]) {
    transaction.mockRejectedValueOnce(failure);
    await expect(recoverMediaJobs(db, queue, config)).resolves.toBe(0);
  }
  transaction.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(recoverMediaJobs(db, queue, config)).rejects.toThrow('database unavailable');
});
