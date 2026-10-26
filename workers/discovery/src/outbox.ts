import { Queue } from 'bullmq';
import type { PrismaClient } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import type { WorkerConfig } from './config.js';
import type { DiscoveryEnvelope } from './pipeline.js';

const supportedEvents = ['SOURCE_SYNC_REQUESTED', 'SOURCE_POST_IMPORTED'] as const;

/** Queue insertion is repeatable by the durable outbox event ID; only then mark the event delivered. */
export async function relayPendingOutbox(db: PrismaClient, queue: Queue<DiscoveryEnvelope>, config: WorkerConfig, workspaceId?: string): Promise<number> {
  const events = await db.outboxEvent.findMany({
    where: { publishedAt: null, eventType: { in: [...supportedEvents] }, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'asc' }, take: config.DISCOVERY_BATCH_SIZE,
  });
  let relayed = 0;
  for (const event of events) {
    const envelope = jobEnvelopeSchema.parse({
      jobId: event.id, workspaceId: event.workspaceId, entityId: event.aggregateId, step: event.eventType,
      version: 1, idempotencyKey: event.id, traceId: event.id, attempt: 0, scheduledAt: event.createdAt.toISOString(),
    });
    await queue.add(event.eventType, envelope, {
      jobId: event.id,
      attempts: config.DISCOVERY_RETRY_ATTEMPTS,
      backoff: { type: 'exponential', delay: config.DISCOVERY_RETRY_DELAY_MS },
      removeOnComplete: { count: 1000 }, removeOnFail: { count: 2000 },
    });
    await db.outboxEvent.updateMany({ where: { id: event.id, workspaceId: event.workspaceId, publishedAt: null }, data: { publishedAt: new Date() } });
    relayed += 1;
  }
  return relayed;
}
