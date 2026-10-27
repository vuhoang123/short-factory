import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@shorts-factory/database';
import { processAnalyticsSync } from './analytics';

afterEach(() => vi.unstubAllEnvs());

function fixture(loseLease = false) {
  const state = { status: 'QUEUED', attempts: 0, leaseUntil: null as Date | null };
  const publication = { id: 'publication-a', workspaceId: 'workspace-a', status: 'PUBLISHED', remotePostId: 'mock:publication-a', publishedAt: new Date('2026-10-01T09:00:00Z'), account: { platform: 'YOUTUBE', externalId: 'fixture-account', secretRef: null, status: 'CONNECTED', capabilityFlags: { analyticsProvider: 'mock' } }, video: { durationMs: 40000 } };
  const analyticsSyncRun = {
    updateMany: vi.fn(async (input: Prisma.AnalyticsSyncRunUpdateManyArgs) => {
      if (input.where?.workspaceId !== 'workspace-a' || input.where?.id !== 'sync-a') return { count: 0 };
      if (input.data.status === 'RUNNING') {
        if (state.status !== 'QUEUED') return { count: 0 };
        state.status = 'RUNNING'; state.attempts += 1;
        state.leaseUntil = input.data.leaseUntil as Date;
        return { count: 1 };
      }
      if (input.data.status === 'SUCCEEDED' && state.status === 'RUNNING' && !loseLease) { state.status = 'SUCCEEDED'; return { count: 1 }; }
      return { count: 0 };
    }),
    findFirst: vi.fn(async () => ({ id: 'sync-a', workspaceId: 'workspace-a', ...state, publication })),
  };
  const tx = { analyticsSyncRun, publicationMetric: { create: vi.fn().mockResolvedValue({ id: 'metric-a' }) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
  const db = { ...tx, publication: { findMany: vi.fn().mockResolvedValue([]) }, $transaction: vi.fn(async (work: (transaction: Prisma.TransactionClient) => Promise<unknown>) => work(tx as unknown as Prisma.TransactionClient)) };
  return { db, tx, state };
}

describe('analytics synchronization recovery', () => {
  it('persists one snapshot and ignores a replay of a successful sync', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { db, tx, state } = fixture();
    await processAnalyticsSync(db as unknown as PrismaClient, 'workspace-a', 'sync-a');
    await processAnalyticsSync(db as unknown as PrismaClient, 'workspace-a', 'sync-a');
    expect(state.status).toBe('SUCCEEDED');
    expect(tx.publicationMetric.create).toHaveBeenCalledTimes(1);
    expect(tx.publicationMetric.create.mock.calls[0]?.[0]).toMatchObject({ data: { workspaceId: 'workspace-a', publicationId: 'publication-a', metrics: { provider: 'mock', synthetic: true } } });
  });

  it('does not commit an external result after another worker replaced its lease', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { db, tx } = fixture(true);
    await processAnalyticsSync(db as unknown as PrismaClient, 'workspace-a', 'sync-a');
    expect(tx.publicationMetric.create).not.toHaveBeenCalled();
  });

  it('does not load or collect another workspace sync', async () => {
    const { db, tx } = fixture();
    await processAnalyticsSync(db as unknown as PrismaClient, 'workspace-b', 'sync-a');
    expect(tx.analyticsSyncRun.findFirst).not.toHaveBeenCalled();
    expect(tx.publicationMetric.create).not.toHaveBeenCalled();
  });
});
