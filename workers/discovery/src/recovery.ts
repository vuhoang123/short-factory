import { Prisma, type PrismaClient } from '@shorts-factory/database';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { WorkerConfig } from './config.js';
import type { DiscoveryEnvelope } from './pipeline.js';

const payloadSchema = z.object({ version: z.number().int().positive().default(1), recoveryAttempts: z.number().int().nonnegative().default(0) }).passthrough();

/** Recovers manual scoring and queued sync delivery; running syncs need a separate fenced lease. */
export async function recoverDiscoveryJobs(db: PrismaClient, queue: Queue<DiscoveryEnvelope>, config: WorkerConfig, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - Math.max(30_000, config.DISCOVERY_RELAY_INTERVAL_MS * 2));
  const events = await db.$queryRaw<Array<{ id: string; workspaceId: string }>>`
    SELECT e."id", e."workspaceId" FROM "OutboxEvent" e
    WHERE e."eventType" IN ('SOURCE_POST_IMPORTED', 'SOURCE_SYNC_REQUESTED') AND e."publishedAt" <= ${cutoff}
      AND COALESCE(e."payload"->>'recoveryExhausted', 'false') <> 'true'
      AND COALESCE(e."payload"->>'recoveryCheckedAt', '') <= ${cutoff.toISOString()}
      AND NOT EXISTS (SELECT 1 FROM "OutboxEvent" newer
        WHERE newer."workspaceId" = e."workspaceId" AND newer."aggregateId" = e."aggregateId"
          AND newer."eventType" = e."eventType" AND (newer."createdAt", newer."id") > (e."createdAt", e."id"))
      AND ((e."eventType" = 'SOURCE_POST_IMPORTED' AND EXISTS (
        SELECT 1 FROM "SourcePost" p WHERE p."id" = e."aggregateId" AND p."workspaceId" = e."workspaceId" AND p."deletedAt" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "ContentCandidate" c WHERE c."sourcePostId" = p."id" AND c."workspaceId" = p."workspaceId")))
        OR (e."eventType" = 'SOURCE_SYNC_REQUESTED' AND EXISTS (
          SELECT 1 FROM "SourceSyncRun" r WHERE r."id" = e."aggregateId" AND r."workspaceId" = e."workspaceId" AND r."status" IN ('QUEUED', 'RETRYING'))))
    ORDER BY COALESCE(e."payload"->>'recoveryCheckedAt', ''), e."publishedAt", e."id" LIMIT ${config.DISCOVERY_BATCH_SIZE}`;
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
      if (event.eventType === 'SOURCE_POST_IMPORTED') {
        const post = await tx.sourcePost.findFirst({ where: { id: event.aggregateId, workspaceId: event.workspaceId, deletedAt: null, candidates: { none: {} } }, select: { id: true } });
        if (!post) return 0;
      } else {
        const run = await tx.sourceSyncRun.findFirst({ where: { id: event.aggregateId, workspaceId: event.workspaceId }, select: { id: true, status: true, attempts: true } });
        if (!run || !['QUEUED', 'RETRYING'].includes(run.status)) return 0;
        if (run.attempts >= config.DISCOVERY_RETRY_ATTEMPTS) {
          await tx.sourceSyncRun.updateMany({ where: { id: run.id, workspaceId: event.workspaceId, status: run.status, attempts: run.attempts }, data: { status: 'FAILED', errorCode: 'QUEUE_RECOVERY_EXHAUSTED', finishedAt: now } });
          return 0;
        }
      }
      const parsed = payloadSchema.safeParse(event.payload);
      if (!parsed.success) return 0;
      const payload = parsed.data;
      if (payload.recoveryAttempts >= config.DISCOVERY_RETRY_ATTEMPTS) {
        await tx.outboxEvent.updateMany({ where: { id: event.id, workspaceId: event.workspaceId, publishedAt: event.publishedAt }, data: { payload: { ...payload, recoveryExhausted: true, recoveryCheckedAt: now.toISOString() } as Prisma.InputJsonObject } });
        await tx.auditLog.create({ data: { workspaceId: event.workspaceId, action: 'DISCOVERY_RECOVERY_EXHAUSTED', resourceType: event.eventType === 'SOURCE_POST_IMPORTED' ? 'SourcePost' : 'SourceSyncRun', resourceId: event.aggregateId, metadata: { eventId: event.id, errorCode: 'QUEUE_RECOVERY_EXHAUSTED' } } });
        return 0;
      }
      const job = await queue.getJob(event.id);
      if (job && !['completed', 'failed'].includes(await job.getState())) {
        await tx.outboxEvent.updateMany({ where: { id: event.id, workspaceId: event.workspaceId, publishedAt: event.publishedAt }, data: { payload: { ...payload, recoveryCheckedAt: now.toISOString() } as Prisma.InputJsonObject } });
        return 0;
      }
      if (job) await job.remove();
      const changed = await tx.outboxEvent.updateMany({ where: { id: event.id, workspaceId: event.workspaceId, publishedAt: event.publishedAt }, data: { publishedAt: null, payload: { ...payload, recoveryAttempts: payload.recoveryAttempts + 1 } as Prisma.InputJsonObject } });
      return changed.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  }
  return recovered;
}
