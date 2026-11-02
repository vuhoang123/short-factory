import { Queue } from 'bullmq';
import type { PrismaClient } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import { z } from 'zod';
import type { WorkerConfig } from './config.js';
import type { DiscoveryEnvelope } from './pipeline.js';

const supportedEvents = ['SOURCE_SYNC_REQUESTED', 'SOURCE_POST_IMPORTED'] as const;
const deliverySchema = z.object({ version: z.number().int().positive().default(1), recoveryAttempts: z.number().int().nonnegative().default(0) }).passthrough();

/** Queue insertion is repeatable by the durable outbox event ID; only then mark the event delivered. */
export async function relayPendingOutbox(db: PrismaClient, queue: Queue<DiscoveryEnvelope>, config: WorkerConfig, workspaceId?: string): Promise<number> {
  const events = await db.outboxEvent.findMany({
    where: { publishedAt: null, eventType: { in: [...supportedEvents] }, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'asc' }, take: config.DISCOVERY_BATCH_SIZE,
  });
  let relayed = 0;
  for (const event of events) {
    const delivery = deliverySchema.parse(event.payload);
    const envelope = jobEnvelopeSchema.parse({
      jobId: event.id, workspaceId: event.workspaceId, entityId: event.aggregateId, step: event.eventType,
      version: delivery.version, idempotencyKey: event.id, traceId: event.id, attempt: delivery.recoveryAttempts, scheduledAt: event.createdAt.toISOString(),
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
