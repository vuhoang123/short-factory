import { Queue } from 'bullmq';
import type { PrismaClient } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import type { MediaWorkerConfig } from './config.js';

export interface MediaEnvelope {
  jobId: string; workspaceId: string; entityId: string; step: string; version: number;
  idempotencyKey: string; traceId: string; attempt: number; scheduledAt: string;
}

/** Enqueue first by durable outbox ID, then mark delivered so worker restarts cannot lose runs. */
export async function relayMediaOutbox(db: PrismaClient, queue: Queue<MediaEnvelope>, config: MediaWorkerConfig): Promise<number> {
  const events = await db.outboxEvent.findMany({
    where: { publishedAt: null, eventType: { in: ['PRODUCTION_RUN_REQUESTED', 'MEDIA_ASSET_DELETE_REQUESTED'] } },
    orderBy: { createdAt: 'asc' }, take: config.MEDIA_BATCH_SIZE,
  });
  let relayed = 0;
  for (const event of events) {
    const envelope = jobEnvelopeSchema.parse({
      jobId: event.id, workspaceId: event.workspaceId, entityId: event.aggregateId, step: event.eventType,
      version: 1, idempotencyKey: event.id, traceId: event.id, attempt: 0, scheduledAt: event.createdAt.toISOString(),
    });
    await queue.add(event.eventType, envelope, {
      jobId: event.id, attempts: config.MEDIA_RETRY_ATTEMPTS,
      backoff: { type: 'exponential', delay: config.MEDIA_RETRY_DELAY_MS },
      removeOnComplete: { count: 1000 }, removeOnFail: { count: 2000 },
    });
    await db.outboxEvent.updateMany({ where: { id: event.id, workspaceId: event.workspaceId, publishedAt: null }, data: { publishedAt: new Date() } });
    relayed += 1;
  }
  return relayed;
}
