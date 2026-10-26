import type { Request } from 'express';
import { Prisma, type PrismaClient } from '@shorts-factory/database';
import { createSourceAdapter } from '@shorts-factory/sources';
import type { SourcePlatform } from '@shorts-factory/shared';
import { AuthService, adminRoles, editRoles, reviewRoles, type AuthContext } from './auth/auth.service.js';
import { ApiError, notFound } from './errors.js';
import { mutationIdentity } from './idempotency.js';
import {
  candidateQuerySchema, candidateReviewSchema, paginationSchema, sourceVerifySchema,
  syncKeySchema, topicRuleSchema, updateSourceSchema, updateTopicRuleSchema,
} from './validation.js';

type Tx = Prisma.TransactionClient;

export class DiscoveryService {
  constructor(readonly db: PrismaClient, readonly auth: AuthService) {}

  private async audit(tx: Tx, context: AuthContext, action: string, resourceType: string, resourceId: string) {
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.userId, action, resourceType, resourceId } });
  }

  private async mutate(request: Request, context: AuthContext, route: string, input: unknown, work: (tx: Tx) => Promise<Prisma.InputJsonObject>) {
    const { key, requestHash } = mutationIdentity(request, input);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.db.$transaction(async tx => {
          const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: context.userId } } });
          if (!member || member.role !== context.role) throw new ApiError(403, 'FORBIDDEN', 'Your workspace permissions changed. Retry the request.');
          const prior = await tx.idempotencyRecord.findUnique({ where: { workspaceId_userId_route_key: { workspaceId: context.workspaceId, userId: context.userId, route, key } } });
          if (prior) {
            if (prior.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
            return prior.response;
          }
          const result = await work(tx);
          await tx.idempotencyRecord.create({ data: { workspaceId: context.workspaceId, userId: context.userId, route, key, requestHash, response: result, statusCode: 200 } });
          return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) continue;
        throw error;
      }
    }
    throw new ApiError(409, 'CONCURRENT_CHANGE', 'The resource changed. Please retry.');
  }

  async updateSource(request: Request, id: string, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const input = updateSourceSchema.parse(raw);
    this.auth.assertWorkspace(context, input.workspaceId);
    return this.mutate(request, context, `/sources/${id}`, { id, input }, async tx => {
      const source = await tx.sourceConfig.findFirst({ where: { id, workspaceId: context.workspaceId } });
      if (!source) return notFound();
      if (input.channelId && !await tx.contentChannel.findFirst({ where: { id: input.channelId, workspaceId: context.workspaceId } })) return notFound();
      const nextConfig = input.config ?? source.config;
      const mode = nextConfig && typeof nextConfig === 'object' && !Array.isArray(nextConfig) && 'mode' in nextConfig ? nextConfig.mode : undefined;
      const isMock = source.platform === 'MANUAL' && mode === 'MOCK_FIXTURE' && process.env.NODE_ENV !== 'production';
      if (source.platform === 'MANUAL' && mode === 'MOCK_FIXTURE' && process.env.NODE_ENV === 'production') throw new ApiError(403, 'MOCK_DISABLED_PRODUCTION', 'Synthetic demo sources are disabled in production.');
      const isManual = source.platform === 'MANUAL' && !isMock;
      const enabled = input.enabled ?? source.enabled;
      const updated = await tx.sourceConfig.update({
        where: { workspaceId_id: { workspaceId: context.workspaceId, id } },
        data: {
          ...(input.sourceKey !== undefined ? { sourceKey: input.sourceKey } : {}),
          ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          ...(input.syncFrequencyMinutes !== undefined ? { syncFrequencyMinutes: input.syncFrequencyMinutes } : {}),
          enabled: (isMock || isManual) && enabled,
          capabilityStatus: isMock || isManual ? 'AVAILABLE' : source.capabilityStatus,
          nextSyncAt: isMock && enabled ? (source.nextSyncAt ?? new Date()) : null,
        },
      });
      await this.audit(tx, context, 'SOURCE_UPDATED', 'SourceConfig', updated.id);
      return { id: updated.id, platform: updated.platform, sourceKey: updated.sourceKey, config: updated.config as Prisma.InputJsonValue, enabled: updated.enabled, capabilityStatus: updated.capabilityStatus, syncFrequencyMinutes: updated.syncFrequencyMinutes };
    });
  }

  async deleteSource(request: Request, id: string) {
    const context = await this.auth.context(request, adminRoles);
    return this.mutate(request, context, `/sources/${id}/delete`, { id }, async tx => {
      const source = await tx.sourceConfig.findFirst({ where: { id, workspaceId: context.workspaceId }, include: { _count: { select: { posts: true } } } });
      if (!source) return notFound();
      if (source._count.posts > 0) throw new ApiError(409, 'SOURCE_HAS_CONTENT', 'Disable this source to preserve its imported content and provenance.');
      await tx.sourceConfig.delete({ where: { workspaceId_id: { workspaceId: context.workspaceId, id } } });
      await this.audit(tx, context, 'SOURCE_DELETED', 'SourceConfig', id);
      return { id, deleted: true };
    });
  }

  async verifySource(request: Request, id: string, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const input = sourceVerifySchema.parse(raw);
    const source = await this.db.sourceConfig.findFirst({ where: { id, workspaceId: context.workspaceId } });
    if (!source) return notFound();
    const adapter = createSourceAdapter(source.platform as SourcePlatform, source.config);
    const access = await adapter.validateAccess();
    return this.mutate(request, context, `/sources/${id}/verify`, { id, input }, async tx => {
      const current = await tx.sourceConfig.findFirst({ where: { id, workspaceId: context.workspaceId } });
      if (!current) return notFound();
      await tx.sourceConfig.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id } }, data: { capabilityStatus: access.status } });
      await this.audit(tx, context, 'SOURCE_ACCESS_CHECKED', 'SourceConfig', id);
      return { id, available: access.available, status: access.status, reason: access.reason ?? null };
    });
  }

  async syncSource(request: Request, id: string) {
    const context = await this.auth.context(request, editRoles);
    const key = syncKeySchema.parse(request.header('idempotency-key'));
    const input = { id, key };
    return this.mutate(request, context, `/sources/${id}/sync`, input, async tx => {
      const source = await tx.sourceConfig.findFirst({ where: { id, workspaceId: context.workspaceId } });
      if (!source) return notFound();
      if (!source.enabled) throw new ApiError(409, 'SOURCE_DISABLED', 'Enable this source before syncing.');
      const config = source.config && typeof source.config === 'object' && !Array.isArray(source.config) ? source.config : {};
      if (source.platform !== 'MANUAL' || config.mode !== 'MOCK_FIXTURE' || process.env.NODE_ENV === 'production') {
        const adapter = createSourceAdapter(source.platform as SourcePlatform, source.config);
        const access = await adapter.validateAccess();
        throw new ApiError(409, access.status === 'AVAILABLE' ? 'MANUAL_IMPORT_ONLY' : access.status, access.reason ?? 'This source cannot be synced in the current environment.');
      }
      const sameRun = await tx.sourceSyncRun.findFirst({ where: { workspaceId: context.workspaceId, sourceConfigId: id, idempotencyKey: key } });
      if (sameRun) return { runId: sameRun.id, status: sameRun.status, duplicateRequest: true };
      const active = await tx.sourceSyncRun.findFirst({ where: { workspaceId: context.workspaceId, sourceConfigId: id, status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] } } });
      if (active) return { runId: active.id, status: active.status, duplicateRequest: true };
      const priorPartial = await tx.sourceSyncRun.findFirst({ where: { workspaceId: context.workspaceId, sourceConfigId: id, status: 'PARTIAL', nextCursor: { not: null } }, orderBy: { startedAt: 'desc' }, select: { nextCursor: true } });
      const run = await tx.sourceSyncRun.create({ data: { workspaceId: context.workspaceId, sourceConfigId: id, idempotencyKey: key, status: 'QUEUED', cursor: priorPartial?.nextCursor ?? null } });
      await tx.sourceConfig.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id } }, data: { lastSyncStatus: 'QUEUED', lastErrorCode: null, lastErrorAt: null, nextSyncAt: new Date(Date.now() + source.syncFrequencyMinutes * 60_000) } });
      await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, eventType: 'SOURCE_SYNC_REQUESTED', aggregateId: run.id, payload: { entityId: run.id, workspaceId: context.workspaceId, version: 1 } } });
      await this.audit(tx, context, 'SOURCE_SYNC_REQUESTED', 'SourceSyncRun', run.id);
      return { runId: run.id, status: run.status, duplicateRequest: false };
    });
  }

  async syncRuns(request: Request, id: string, raw: unknown) {
    const context = await this.auth.context(request);
    const page = paginationSchema.parse(raw);
    if (!await this.db.sourceConfig.findFirst({ where: { id, workspaceId: context.workspaceId } })) return notFound();
    const items = await this.db.sourceSyncRun.findMany({ where: { workspaceId: context.workspaceId, sourceConfigId: id }, orderBy: { startedAt: 'desc' }, take: page.limit + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { items: items.slice(0, page.limit), nextCursor: items.length > page.limit ? items[page.limit - 1]?.id ?? null : null };
  }

  async topicRules(request: Request, raw: unknown) {
    const context = await this.auth.context(request);
    const page = paginationSchema.parse(raw);
    if (page.cursor && !await this.db.topicRule.findFirst({ where: { id: page.cursor, workspaceId: context.workspaceId } })) return notFound();
    const items = await this.db.topicRule.findMany({ where: { workspaceId: context.workspaceId, ...(page.q ? { name: { contains: page.q, mode: 'insensitive' } } : {}) }, orderBy: { createdAt: 'desc' }, take: page.limit + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { items: items.slice(0, page.limit), nextCursor: items.length > page.limit ? items[page.limit - 1]?.id ?? null : null };
  }

  async createTopicRule(request: Request, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const input = topicRuleSchema.parse(raw);
    this.auth.assertWorkspace(context, input.workspaceId);
    return this.mutate(request, context, '/topic-rules', input, async tx => {
      if (!await tx.contentChannel.findFirst({ where: { id: input.channelId, workspaceId: context.workspaceId } })) return notFound();
      const rule = await tx.topicRule.create({ data: { ...input, workspaceId: context.workspaceId } });
      await this.audit(tx, context, 'TOPIC_RULE_CREATED', 'TopicRule', rule.id);
      return { id: rule.id, name: rule.name, channelId: rule.channelId, enabled: rule.enabled, minimumScore: rule.minimumScore };
    });
  }

  async updateTopicRule(request: Request, id: string, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const input = updateTopicRuleSchema.parse(raw);
    return this.mutate(request, context, `/topic-rules/${id}`, input, async tx => {
      const rule = await tx.topicRule.findFirst({ where: { id, workspaceId: context.workspaceId } });
      if (!rule) return notFound();
      const updated = await tx.topicRule.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id } }, data: input });
      await this.audit(tx, context, 'TOPIC_RULE_UPDATED', 'TopicRule', id);
      return { id: updated.id, name: updated.name, channelId: updated.channelId, enabled: updated.enabled, minimumScore: updated.minimumScore };
    });
  }

  async deleteTopicRule(request: Request, id: string) {
    const context = await this.auth.context(request, adminRoles);
    return this.mutate(request, context, `/topic-rules/${id}/delete`, { id }, async tx => {
      if (!await tx.topicRule.findFirst({ where: { id, workspaceId: context.workspaceId } })) return notFound();
      await tx.topicRule.delete({ where: { workspaceId_id: { workspaceId: context.workspaceId, id } } });
      await this.audit(tx, context, 'TOPIC_RULE_DELETED', 'TopicRule', id);
      return { id, deleted: true };
    });
  }

  async candidates(request: Request, raw: unknown) {
    const context = await this.auth.context(request);
    const input = candidateQuerySchema.parse(raw);
    if (input.cursor && !await this.db.contentCandidate.findFirst({ where: { id: input.cursor, workspaceId: context.workspaceId } })) return notFound();
    const postFilter: Prisma.SourcePostWhereInput = {
      deletedAt: null,
      ...(input.platform ? { platform: input.platform } : {}),
      ...(input.topic ? { topicTags: { has: input.topic } } : {}),
      ...(input.q ? { OR: [{ title: { contains: input.q, mode: 'insensitive' } }, { body: { contains: input.q, mode: 'insensitive' } }] } : {}),
      ...(input.rightsStatus ? { rights: { some: { reviewStatus: input.rightsStatus } } } : {}),
    };
    const rows = await this.db.contentCandidate.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(input.minScore !== undefined ? { score: { gte: input.minScore } } : {}),
        ...(input.candidateStatus ? { status: input.candidateStatus } : {}),
        post: postFilter,
      },
      orderBy: input.sort === 'NEWEST' ? { createdAt: 'desc' } : { score: input.sort === 'SCORE_ASC' ? 'asc' : 'desc' },
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: { post: { include: { rights: { orderBy: { createdAt: 'desc' } }, comments: { orderBy: { publishedAt: 'desc' }, take: 20 }, metricSnapshots: { orderBy: { measuredAt: 'desc' }, take: 1 }, source: { select: { sourceKey: true, platform: true } } } } },
    });
    return { items: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? rows[input.limit - 1]?.id ?? null : null };
  }

  async reviewCandidate(request: Request, id: string, raw: unknown) {
    const context = await this.auth.context(request, reviewRoles);
    const input = candidateReviewSchema.parse(raw);
    return this.mutate(request, context, `/candidates/${id}/review`, input, async tx => {
      const candidate = await tx.contentCandidate.findFirst({ where: { id, workspaceId: context.workspaceId }, include: { post: { include: { rights: { orderBy: { createdAt: 'desc' } } } } } });
      if (!candidate || candidate.post.deletedAt) return notFound();
      if (['APPROVED', 'REJECTED', 'BLOCKED_RIGHTS', 'BLOCKED_SAFETY', 'BELOW_THRESHOLD', 'DUPLICATE'].includes(candidate.status)) throw new ApiError(409, 'INVALID_TRANSITION', 'This candidate is no longer awaiting review.');
      if (input.decision === 'APPROVED') {
        if ((candidate.post.sensitiveFlags?.length ?? 0) > 0) throw new ApiError(403, 'BLOCKED_SAFETY', 'Sensitive personal information must be resolved before approval.');
        if (candidate.score === null || candidate.score < candidate.minimumScore) throw new ApiError(403, 'BELOW_THRESHOLD', 'This candidate is below the channel score threshold.');
        const right = candidate.post.rights[0];
        if (!right || right.reviewStatus !== 'APPROVED' || right.basis === 'UNKNOWN' || !right.attested || !right.commercialAllowed || right.revokedAt || (right.expiresAt && right.expiresAt <= new Date())) throw new ApiError(403, 'BLOCKED_RIGHTS', 'Rights review must approve eligible commercial use first.');
      }
      await tx.contentCandidate.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id } }, data: { status: input.decision } });
      await this.audit(tx, context, `CANDIDATE_${input.decision}`, 'ContentCandidate', id);
      return { id, status: input.decision };
    });
  }
}
