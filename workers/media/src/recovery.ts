import { Prisma, type PrismaClient } from '@shorts-factory/database';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { MediaWorkerConfig } from './config.js';
import type { MediaEnvelope } from './outbox.js';

const payloadSchema = z.object({ version: z.number().int().positive().default(1), recoveryAttempts: z.number().int().nonnegative().default(0) }).passthrough();
const recoverable = ['QUEUED', 'RUNNING', 'FAILED_RETRYABLE'];

/** PostgreSQL owns retry state; Redis loss reopens the same event, never a second logical production. */
export async function recoverMediaJobs(db: PrismaClient, queue: Queue<MediaEnvelope>, config: MediaWorkerConfig, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - Math.max(30_000, config.MEDIA_RELAY_INTERVAL_MS * 2));
  const events = await db.$queryRaw<Array<{ id: string; workspaceId: string }>>`
    SELECT e."id", e."workspaceId" FROM "OutboxEvent" e
    JOIN "ProductionRun" r ON r."id" = e."aggregateId" AND r."workspaceId" = e."workspaceId"
    WHERE e."eventType" = 'PRODUCTION_RUN_REQUESTED' AND e."publishedAt" <= ${cutoff}
      AND COALESCE(e."payload"->>'recoveryCheckedAt', '') <= ${cutoff.toISOString()}
      AND r."status" IN ('QUEUED', 'RUNNING', 'FAILED_RETRYABLE')
      AND (r."status" <> 'RUNNING' OR r."workerLeaseUntil" IS NULL OR r."workerLeaseUntil" <= ${now})
      AND NOT EXISTS (SELECT 1 FROM "OutboxEvent" newer
        WHERE newer."workspaceId" = e."workspaceId" AND newer."aggregateId" = e."aggregateId"
          AND newer."eventType" = e."eventType" AND (newer."createdAt", newer."id") > (e."createdAt", e."id"))
    ORDER BY COALESCE(e."payload"->>'recoveryCheckedAt', ''), e."publishedAt", e."id"
    LIMIT ${config.MEDIA_BATCH_SIZE}`;
  let recovered = 0;
  for (const candidate of events) {
    recovered += await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "OutboxEvent" WHERE "id" = ${candidate.id} AND "workspaceId" = ${candidate.workspaceId}
          AND "publishedAt" <= ${cutoff}
          AND COALESCE("payload"->>'recoveryCheckedAt', '') <= ${cutoff.toISOString()}
        FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return 0;
      const event = await tx.outboxEvent.findFirst({ where: { id: candidate.id, workspaceId: candidate.workspaceId } });
      if (!event?.publishedAt) return 0;
      const latest = await tx.outboxEvent.findFirst({ where: { workspaceId: event.workspaceId, aggregateId: event.aggregateId, eventType: event.eventType }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      if (latest?.id !== event.id) return 0;
      const run = await tx.productionRun.findFirst({ where: { id: event.aggregateId, workspaceId: event.workspaceId }, select: { id: true, status: true, attempts: true, workerLeaseUntil: true } });
      if (!run || !recoverable.includes(run.status) || (run.status === 'RUNNING' && run.workerLeaseUntil && run.workerLeaseUntil > now)) return 0;
      const parsed = payloadSchema.safeParse(event.payload);
      if (!parsed.success) return 0;
      const payload = parsed.data;
      const job = await queue.getJob(event.id);
      if (job && !['completed', 'failed'].includes(await job.getState())) {
        // Rotate healthy deliveries out of a bounded scan so a backlog cannot hide later lost jobs.
        await tx.outboxEvent.updateMany({ where: { id: event.id, workspaceId: event.workspaceId, publishedAt: event.publishedAt }, data: { payload: { ...payload, recoveryCheckedAt: now.toISOString() } as Prisma.InputJsonObject } });
        return 0;
      }
      const runFence = { id: run.id, workspaceId: event.workspaceId, status: run.status, attempts: run.attempts, workerLeaseUntil: run.workerLeaseUntil };
      if (payload.recoveryAttempts >= config.MEDIA_RETRY_ATTEMPTS || run.attempts - (payload.version - 1) >= config.MEDIA_RETRY_ATTEMPTS) {
        const settled = await tx.productionRun.updateMany({ where: runFence, data: { status: 'FAILED_PERMANENT', errorCode: 'QUEUE_RECOVERY_EXHAUSTED', completedAt: now, workerLeaseUntil: null } });
        if (settled.count) await tx.renderJob.updateMany({ where: { workspaceId: event.workspaceId, productionRunId: run.id }, data: { status: 'FAILED_PERMANENT', errorCode: 'QUEUE_RECOVERY_EXHAUSTED', completedAt: now } });
        return 0;
      }
      if (job) await job.remove();
      const claimed = await tx.productionRun.updateMany({ where: runFence, data: { status: 'QUEUED', workerLeaseUntil: null, completedAt: null, errorCode: null } });
      if (!claimed.count) return 0;
      await tx.renderJob.updateMany({ where: { workspaceId: event.workspaceId, productionRunId: run.id }, data: { status: 'QUEUED', completedAt: null, errorCode: null } });
      const changed = await tx.outboxEvent.updateMany({ where: { id: event.id, workspaceId: event.workspaceId, publishedAt: event.publishedAt }, data: { publishedAt: null, payload: { ...payload, recoveryAttempts: payload.recoveryAttempts + 1 } as Prisma.InputJsonObject } });
      return changed.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 }).catch((error: unknown) => {
      // A competing sweeper can invalidate this snapshot; the next sweep rechecks durable state.
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'))) return 0;
      throw error;
    });
  }
  return recovered;
}
