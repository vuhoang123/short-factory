import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@shorts-factory/database';
import { expect, it, vi } from 'vitest';
import type { MediaWorkerConfig } from './config.js';
import { relayMediaOutbox, type MediaEnvelope } from './outbox.js';

it('relays production outbox events by durable event ID and marks each delivered only afterward', async () => {
  const eventId = randomUUID();
  const workspaceId = randomUUID();
  const runId = randomUUID();
  const createdAt = new Date();
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findMany = vi.fn(async () => [{ id: eventId, workspaceId, aggregateId: runId, eventType: 'PRODUCTION_RUN_REQUESTED', payload: {}, createdAt }]);
  const db = { outboxEvent: { findMany, updateMany } } as unknown as PrismaClient;
  const add = vi.fn(async () => ({}));
  const queue = { add } as unknown as Queue<MediaEnvelope>;
  const config = { MEDIA_BATCH_SIZE: 20, MEDIA_RETRY_ATTEMPTS: 3, MEDIA_RETRY_DELAY_MS: 2000 } as MediaWorkerConfig;

  expect(await relayMediaOutbox(db, queue, config)).toBe(1);
  expect(add).toHaveBeenCalledWith('PRODUCTION_RUN_REQUESTED', expect.objectContaining({ jobId: eventId, workspaceId, entityId: runId, idempotencyKey: eventId }), expect.objectContaining({ jobId: eventId, attempts: 3 }));
  expect(updateMany).toHaveBeenCalledWith({ where: { id: eventId, workspaceId, publishedAt: null }, data: { publishedAt: expect.any(Date) } });
});
