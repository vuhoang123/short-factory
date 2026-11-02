import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@shorts-factory/database';
import { z } from 'zod';
import { afterEach, expect, it, vi } from 'vitest';
import { readMediaWorkerConfig } from './config.js';
import { MediaProductionPipeline } from './pipeline.js';
import type { ProductionInput } from '@shorts-factory/media';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

interface Controls {
  stage(run: unknown, name: string, schema: z.ZodType, work: () => Promise<unknown>): Promise<unknown>;
  assertRunActive(tx: unknown, run: unknown, input: unknown): Promise<void>;
  watchRender(run: unknown, signal: AbortController): { stop(): Promise<void> };
}
function fixture() {
  const run = { id: randomUUID(), workspaceId: randomUUID(), attempts: 1, story: { post: { id: randomUUID() } } };
  const current = { id: run.id, status: 'RUNNING', attempts: 1, workerLeaseUntil: new Date(Date.now() + 90_000) };
  const db = {
    productionRun: { findFirst: vi.fn(async () => current), updateMany: vi.fn(async () => ({ count: 1 })) },
    productionStage: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({ attempts: 1 })), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn() },
    sourcePost: { findFirst: vi.fn(async () => ({ comments: [], sensitiveFlags: [], rights: [{ reviewStatus: 'APPROVED', attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], revokedAt: null, expiresAt: null, attributionRequired: false }] })) },
    workflowRun: { findFirst: vi.fn(async () => null) },
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
  };
  const config = readMediaWorkerConfig({ DATABASE_URL: 'postgresql://localhost/unused_test', REDIS_URL: 'redis://localhost', MEDIA_CANCEL_POLL_MS: '100' });
  const pipeline = new MediaProductionPipeline(db as unknown as PrismaClient, config) as unknown as Controls;
  return { run, current, db, pipeline };
}

it('reports user cancellation instead of falsely changing it into blocked rights', async () => {
  const f = fixture();
  f.db.productionRun.findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce({ ...f.current, status: 'CANCELLED' });
  await expect(f.pipeline.assertRunActive(f.db, f.run, { commentIds: [], backgroundAssetId: null })).rejects.toThrow('USER_CANCELLED');
});

it('never lets a failed old attempt mark a newer attempt stage as failed', async () => {
  const f = fixture();
  const failure = new Error('OLD_ATTEMPT_FAILED');
  await expect(f.pipeline.stage(f.run, 'VIDEO_RENDER', z.object({ ok: z.boolean() }), async () => {
    f.db.productionRun.findFirst.mockResolvedValue(null as never);
    throw failure;
  })).rejects.toBe(failure);
  expect(f.db.productionStage.updateMany).not.toHaveBeenCalled();
});

it('polls database cancellation during a render and aborts its controller', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const controller = new AbortController();
  const watcher = f.pipeline.watchRender(f.run, controller);
  f.db.productionRun.findFirst.mockResolvedValue({ ...f.current, status: 'CANCELLED' });
  await vi.advanceTimersByTimeAsync(100);
  expect(controller.signal.aborted).toBe(true);
  expect(controller.signal.reason.message).toBe('USER_CANCELLED');
  await watcher.stop();
});

it('aborts rendering after a worker loses its attempt lease', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const controller = new AbortController();
  const watcher = f.pipeline.watchRender(f.run, controller);
  f.db.productionRun.findFirst.mockResolvedValue({ ...f.current, attempts: 2 });
  await vi.advanceTimersByTimeAsync(100);
  expect(controller.signal.reason.message).toBe('WORKER_LEASE_LOST');
  await watcher.stop();
});

function processFixture(status: string, attempts = 0, version = 1) {
  const f = fixture();
  const input: ProductionInput = { mode: 'CREATE', candidateId: null, channelId: randomUUID(), commentIds: [], language: 'vi', targetDurationSec: 25,
    style: 'STORYTELLING', voiceProfileId: 'mock:default', voiceId: 'demo-tone', speakingRate: 1, templateId: 'SocialCommentary', backgroundAssetId: null,
    subtitlePreset: 'ClassicCaption', theme: 'dark', anonymizeAuthors: true, showEngagement: false, selectedSegmentIds: [], storyVersionId: null };
  const saved = { ...f.run, input, status, attempts, startedAt: null };
  f.db.productionRun.findFirst.mockResolvedValue(saved as never);
  const renderJobUpdate = vi.fn(async () => ({ count: 1 }));
  const latestRequest = vi.fn(async () => ({ payload: { version } }));
  const db = Object.assign(f.db, { renderJob: { updateMany: renderJobUpdate }, outboxEvent: { findFirst: latestRequest } });
  const config = readMediaWorkerConfig({ DATABASE_URL: 'postgresql://localhost/unused_test', REDIS_URL: 'redis://localhost' });
  const pipeline = new MediaProductionPipeline(db as unknown as PrismaClient, config);
  const execute = vi.spyOn(pipeline as unknown as { execute(run: unknown, input: unknown): Promise<void> }, 'execute').mockResolvedValue(undefined);
  const envelope = (version: number) => ({ jobId: randomUUID(), workspaceId: saved.workspaceId, entityId: saved.id, step: 'PRODUCTION_RUN_REQUESTED', version,
    idempotencyKey: randomUUID(), traceId: randomUUID(), attempt: 0, scheduledAt: new Date().toISOString() });
  return { ...f, db, pipeline, execute, renderJobUpdate, latestRequest, saved, envelope };
}

it('does not automatically reclaim permanent failures or cancelled runs', async () => {
  for (const status of ['FAILED_PERMANENT', 'CANCELLED']) {
    const f = processFixture(status);
    await f.pipeline.process(f.envelope(1));
    expect(f.db.productionRun.updateMany).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  }
});

it('uses persisted attempts to bound retries after Redis loses its counters', async () => {
  const f = processFixture('FAILED_RETRYABLE', 3);
  await f.pipeline.process(f.envelope(1), 0, 3);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.db.productionRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED_PERMANENT', errorCode: 'ATTEMPTS_EXHAUSTED' }) }));
});

it('starts a new retry budget only for an explicit durable version and preserves cancelled DB state', async () => {
  const f = processFixture('QUEUED', 3, 4);
  f.execute.mockImplementation(async () => { f.db.productionRun.updateMany.mockResolvedValue({ count: 0 }); throw new Error('USER_CANCELLED'); });
  await f.pipeline.process(f.envelope(4), 0, 3);
  expect(f.execute).toHaveBeenCalledOnce();
  expect(f.renderJobUpdate).toHaveBeenCalledTimes(1);
  expect(f.db.productionRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ attempts: 4 }), data: { workerLeaseUntil: null } }));
});

it('ignores an exhausted old envelope without consuming the newer durable retry budget', async () => {
  const f = processFixture('QUEUED', 3, 4);
  await f.pipeline.process(f.envelope(1), 0, 3);
  expect(f.db.productionRun.updateMany).not.toHaveBeenCalled();
  expect(f.renderJobUpdate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  await f.pipeline.process(f.envelope(4), 0, 3);
  expect(f.execute).toHaveBeenCalledOnce();
  expect(f.latestRequest).toHaveBeenCalledWith({ where: { workspaceId: f.saved.workspaceId, aggregateId: f.saved.id, eventType: 'PRODUCTION_RUN_REQUESTED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { payload: true } });
  expect(f.db.productionRun.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ errorCode: 'ATTEMPTS_EXHAUSTED' }) }));
});

it('does not claim work or grant a retry budget without a matching durable request', async () => {
  const f = processFixture('QUEUED', 3);
  await f.pipeline.process(f.envelope(4), 0, 3);
  f.latestRequest.mockResolvedValueOnce(null as never);
  await f.pipeline.process(f.envelope(1), 0, 3);
  expect(f.db.productionRun.updateMany).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
