import { Prisma, PrismaClient } from '@shorts-factory/database';

/** Creates due synthetic demo runs with a row lock and commits run + outbox atomically. */
export async function scheduleDueSources(db: PrismaClient, batchSize: number, now = new Date()): Promise<number> {
  let created = 0;
  for (let index = 0; index < batchSize; index += 1) {
    const didCreate = await db.$transaction(async tx => {
      const sources = await tx.$queryRaw<Array<{ id: string; workspaceId: string; syncFrequencyMinutes: number; nextSyncAt: Date }>>`
        SELECT s."id", s."workspaceId", s."syncFrequencyMinutes", s."nextSyncAt"
        FROM "SourceConfig" s
        WHERE s."enabled" = true
          AND s."platform" = 'MANUAL'
          AND s."capabilityStatus" = 'AVAILABLE'
          AND s."config"->>'mode' = 'MOCK_FIXTURE'
          AND s."nextSyncAt" IS NOT NULL
          AND s."nextSyncAt" <= ${now}
          AND NOT EXISTS (
            SELECT 1 FROM "SourceSyncRun" r
            WHERE r."workspaceId" = s."workspaceId" AND r."sourceConfigId" = s."id"
              AND r."status" IN ('QUEUED', 'RUNNING', 'RETRYING')
          )
        ORDER BY s."nextSyncAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`;
      const source = sources[0];
      if (!source) return false;
      const partial = await tx.sourceSyncRun.findFirst({ where: { workspaceId: source.workspaceId, sourceConfigId: source.id, status: 'PARTIAL', nextCursor: { not: null } }, orderBy: { startedAt: 'desc' }, select: { nextCursor: true } });
      const run = await tx.sourceSyncRun.create({ data: {
        workspaceId: source.workspaceId, sourceConfigId: source.id, status: 'QUEUED',
        idempotencyKey: `schedule:${source.nextSyncAt.getTime()}`,
        cursor: partial?.nextCursor ?? null,
      } });
      const nextSyncAt = new Date(now.getTime() + source.syncFrequencyMinutes * 60_000);
      await tx.sourceConfig.update({ where: { workspaceId_id: { workspaceId: source.workspaceId, id: source.id } }, data: { nextSyncAt, lastSyncStatus: 'QUEUED', lastErrorCode: null, lastErrorAt: null } });
      await tx.outboxEvent.create({ data: { workspaceId: source.workspaceId, eventType: 'SOURCE_SYNC_REQUESTED', aggregateId: run.id, payload: { entityId: run.id, workspaceId: source.workspaceId, version: 1 } } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!didCreate) break;
    created += 1;
  }
  return created;
}
