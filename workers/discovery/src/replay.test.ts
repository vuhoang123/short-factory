import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@shorts-factory/database';
import { expect, it, vi } from 'vitest';
import { DiscoveryPipeline } from './pipeline.js';
import { readWorkerConfig } from './config.js';

vi.mock('@shorts-factory/sources', async (original) => ({
  ...await original<typeof import('@shorts-factory/sources')>(),
  createSourceAdapter: () => ({ validateAccess: async () => ({ available: true }), discover: async () => ({ posts: [] }) }),
}));

it.each(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'])('keeps a completed %s discovery run unchanged on job replay', async (status) => {
  const workspaceId = randomUUID(), entityId = randomUUID();
  const run = { id: entityId, workspaceId, status, attempts: 1, source: { id: randomUUID(), enabled: true, platform: 'MANUAL', config: { mode: 'MOCK_FIXTURE' } } };
  const update = vi.fn(async () => ({}));
  const tx = { sourceSyncRun: { update }, sourceConfig: { update } };
  const db = { sourceSyncRun: { findFirst: vi.fn(async () => run), update }, $transaction: vi.fn(async (work: (client: typeof tx) => Promise<void>) => work(tx)) } as unknown as PrismaClient;
  await new DiscoveryPipeline(db, readWorkerConfig({ DATABASE_URL: 'postgresql://localhost/unused_test', REDIS_URL: 'redis://localhost' })).process({ jobId: randomUUID(), workspaceId, entityId, step: 'SOURCE_SYNC_REQUESTED', version: 1, idempotencyKey: 'replay-test', traceId: randomUUID(), attempt: 0, scheduledAt: new Date().toISOString() });
  expect(update).not.toHaveBeenCalled();
});
