import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { Prisma, type ContentRight, type PrismaClient } from '@shorts-factory/database';
import { evaluateRights, hashPostContent, normalizeText, redactPersonalData } from '@shorts-factory/shared';
import { detectSensitiveFlags } from '@shorts-factory/sources';
import { AuthService, adminRoles, editRoles, reviewRoles, type AuthContext } from './auth/auth.service.js';
import { ApiError, notFound } from './errors.js';
import { mutationIdentity } from './idempotency.js';
import { channelSchema, eligibilitySchema, manualImportSchema, paginationSchema, publicationSchema, reviewSchema, sourceSchema, takedownSchema } from './validation.js';

export function minimizeText(text: string): string {
  return redactPersonalData(normalizeText(text));
}

export function hashContent(title: string | null, body: string): string {
  return hashPostContent(title ?? undefined, body);
}

function evaluateStoredRights(rights: ContentRight | undefined, platform: string) {
  const result = evaluateRights(rights, platform);
  return { allowed: result.eligible, reasons: result.blockers };
}

export class ContentService {
  constructor(readonly db: PrismaClient, readonly auth: AuthService) {}

  private async mutation(request: Request, context: AuthContext, route: string, input: unknown, work: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonObject>) {
    const { key, requestHash } = mutationIdentity(request, input);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: context.userId } } });
          if (!member || member.role !== context.role) throw new ApiError(403, 'FORBIDDEN', 'Your workspace permissions changed. Retry the request.');
          const old = await tx.idempotencyRecord.findUnique({ where: { workspaceId_userId_route_key: { workspaceId: context.workspaceId, userId: context.userId, route, key } } });
          if (old) {
            if (old.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
            return old.response;
          }
          const response = await work(tx);
          await tx.idempotencyRecord.create({ data: { workspaceId: context.workspaceId, userId: context.userId, route, key, requestHash, response, statusCode: 201 } });
          return response;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) continue;
        throw error;
      }
    }
    throw new ApiError(409, 'CONCURRENT_CHANGE', 'The resource changed. Please retry.');
  }

  private async audit(tx: Prisma.TransactionClient, context: AuthContext, action: string, resourceType: string, resourceId: string, metadata?: Prisma.InputJsonObject) {
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.userId, action, resourceType, resourceId, ...(metadata ? { metadata } : {}) } });
  }

  private async event(tx: Prisma.TransactionClient, context: AuthContext, eventType: string, aggregateId: string) {
    await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, eventType, aggregateId, payload: { entityId: aggregateId, workspaceId: context.workspaceId, version: 1 } } });
  }

  async createChannel(request: Request, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const input = channelSchema.parse(raw);
    this.auth.assertWorkspace(context, input.workspaceId);
    return this.mutation(request, context, '/channels', input, async (tx) => {
      const channel = await tx.contentChannel.create({ data: { workspaceId: context.workspaceId, name: input.name, language: input.language, topicConfig: input.topicConfig, automationConfig: input.automationConfig, minimumCandidateScore: input.minimumCandidateScore } });
      await this.audit(tx, context, 'CHANNEL_CREATED', 'ContentChannel', channel.id);
      return { id: channel.id, name: channel.name, language: channel.language };
    });
  }

  async channels(request: Request, raw: unknown) {
    const context = await this.auth.context(request);
    const page = paginationSchema.parse(raw);
    if (page.cursor && !await this.db.contentChannel.findFirst({ where: { id: page.cursor, workspaceId: context.workspaceId } })) return notFound();
    const items = await this.db.contentChannel.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { id: 'desc' }, take: page.limit + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { items: items.slice(0, page.limit), nextCursor: items.length > page.limit ? items[page.limit - 1]?.id ?? null : null };
  }

  async createSource(request: Request, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const input = sourceSchema.parse(raw);
    this.auth.assertWorkspace(context, input.workspaceId);
    if (input.platform === 'MANUAL' && input.config.mode === 'MOCK_FIXTURE' && process.env.NODE_ENV === 'production') throw new ApiError(403, 'MOCK_DISABLED_PRODUCTION', 'Synthetic demo sources are disabled in production.');
    return this.mutation(request, context, '/sources', input, async (tx) => {
      if (input.channelId && !await tx.contentChannel.findFirst({ where: { id: input.channelId, workspaceId: context.workspaceId } })) return notFound();
      const manual = input.platform === 'MANUAL';
      const mock = manual && input.config.mode === 'MOCK_FIXTURE' && process.env.NODE_ENV !== 'production';
      const source = await tx.sourceConfig.create({ data: { workspaceId: context.workspaceId, channelId: input.channelId ?? null, platform: input.platform, sourceKey: input.sourceKey, config: input.config, enabled: manual && input.enabled, capabilityStatus: manual ? 'AVAILABLE' : 'BLOCKED_EXTERNAL', syncFrequencyMinutes: input.syncFrequencyMinutes, nextSyncAt: mock && input.enabled ? new Date() : null } });
      await this.audit(tx, context, 'SOURCE_CONFIGURED', 'SourceConfig', source.id, { platform: source.platform, capabilityStatus: source.capabilityStatus });
      return { id: source.id, platform: source.platform, enabled: source.enabled, capabilityStatus: source.capabilityStatus, syncFrequencyMinutes: source.syncFrequencyMinutes, nextSyncAt: source.nextSyncAt };
    });
  }

  async sources(request: Request, raw: unknown) {
    const context = await this.auth.context(request);
    const page = paginationSchema.parse(raw);
    if (page.cursor && !await this.db.sourceConfig.findFirst({ where: { id: page.cursor, workspaceId: context.workspaceId } })) return notFound();
    const items = await this.db.sourceConfig.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { id: 'desc' }, take: page.limit + 1, include: { channel: { select: { id: true, name: true } }, runs: { orderBy: { startedAt: 'desc' }, take: 1 } }, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { items: items.slice(0, page.limit), nextCursor: items.length > page.limit ? items[page.limit - 1]?.id ?? null : null };
  }

  async importManual(request: Request, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = manualImportSchema.parse(raw);
    this.auth.assertWorkspace(context, input.workspaceId);
    return this.mutation(request, context, '/imports/manual', input, async (tx) => {
      const source = input.sourceConfigId ? await tx.sourceConfig.findFirst({ where: { id: input.sourceConfigId, workspaceId: context.workspaceId } }) : null;
      if (input.sourceConfigId && !source) return notFound();
      if (source && source.platform !== 'MANUAL') throw new ApiError(400, 'INVALID_SOURCE', 'A manual import must use a manual source.');
      if (input.channelId && !await tx.contentChannel.findFirst({ where: { id: input.channelId, workspaceId: context.workspaceId } })) return notFound();
      if (source?.channelId && input.channelId && source.channelId !== input.channelId) throw new ApiError(400, 'CHANNEL_MISMATCH', 'The source belongs to a different content channel.');
      if (input.rights.evidenceAssetId && !await tx.mediaAsset.findFirst({ where: { id: input.rights.evidenceAssetId, workspaceId: context.workspaceId } })) return notFound();
      const title = input.title ? minimizeText(input.title) : null;
      const body = minimizeText(input.body);
      const contentHash = hashContent(title, body);
      const url = new URL(input.canonicalUrl);
      url.search = '';
      url.hash = '';
      const canonicalUrl = url.toString();
      const externalPostId = input.externalPostId ?? createHash('sha256').update(canonicalUrl).digest('hex');
      const duplicate = await tx.sourcePost.findFirst({ where: { workspaceId: context.workspaceId, platform: 'MANUAL', OR: [{ externalPostId }, { contentHash }] } });
      if (duplicate) {
        if (duplicate.deletedAt) throw new ApiError(409, 'CONTENT_TAKEN_DOWN', 'This source was removed and cannot be reimported.');
        await this.audit(tx, context, 'IMPORT_DEDUPLICATED', 'SourcePost', duplicate.id);
        return { postId: duplicate.id, deduplicated: true, warnings: ['Existing content and rights were preserved.'] };
      }
      const post = await tx.sourcePost.create({ data: {
        workspaceId: context.workspaceId, platform: 'MANUAL', externalPostId, canonicalUrl,
        sourceConfigId: source?.id ?? null, channelId: input.channelId ?? source?.channelId ?? null,
        title, body, contentHash, publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
        sensitiveFlags: [...new Set(detectSensitiveFlags(`${title ?? ''}\n${body}`))],
      } });
      if (input.comments.length) await tx.sourceComment.createMany({ data: input.comments.map((comment) => { const body = minimizeText(comment.body); return { workspaceId: context.workspaceId, sourcePostId: post.id, externalId: comment.externalId, parentExternalId: comment.parentExternalId ?? null, body, sensitiveFlags: [...new Set(detectSensitiveFlags(body))], likes: comment.likes ?? null, publishedAt: comment.publishedAt ? new Date(comment.publishedAt) : null }; }) });
      await tx.contentRight.create({ data: { workspaceId: context.workspaceId, sourcePostId: post.id, basis: input.rights.basis, attested: input.rights.attested, evidence: input.rights.evidence ?? null, evidenceAssetId: input.rights.evidenceAssetId ?? null, commercialAllowed: input.rights.commercialAllowed, allowedPlatforms: [...new Set(input.rights.allowedPlatforms)], territory: input.rights.territory, attributionRequired: input.rights.attributionRequired, attributionText: input.rights.attributionText ?? null, expiresAt: input.rights.expiresAt ? new Date(input.rights.expiresAt) : null, reviewStatus: 'PENDING' } });
      await this.audit(tx, context, 'MANUAL_IMPORTED', 'SourcePost', post.id, { commentCount: input.comments.length, basis: input.rights.basis });
      await this.event(tx, context, 'SOURCE_POST_IMPORTED', post.id);
      return { postId: post.id, deduplicated: false, warnings: ['Email addresses and international phone numbers are redacted; URL query parameters are discarded.', 'Human rights review is required before downstream publication.'] };
    });
  }

  async posts(request: Request, raw: unknown) {
    const context = await this.auth.context(request);
    const page = paginationSchema.parse(raw);
    if (page.cursor && !await this.db.sourcePost.findFirst({ where: { id: page.cursor, workspaceId: context.workspaceId, deletedAt: null } })) return notFound();
    const items = await this.db.sourcePost.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, ...(page.q ? { OR: [{ title: { contains: page.q, mode: 'insensitive' } }, { body: { contains: page.q, mode: 'insensitive' } }] } : {}) }, orderBy: { id: 'desc' }, take: page.limit + 1, include: { rights: { orderBy: { createdAt: 'desc' } }, _count: { select: { comments: true } } }, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    await this.audit(this.db, context, 'CONTENT_LIBRARY_READ', 'Workspace', context.workspaceId);
    return { items: items.slice(0, page.limit), nextCursor: items.length > page.limit ? items[page.limit - 1]?.id ?? null : null };
  }

  async post(request: Request, id: string) {
    const context = await this.auth.context(request);
    const post = await this.db.sourcePost.findFirst({ where: { workspaceId: context.workspaceId, id, deletedAt: null }, include: { rights: true, _count: { select: { comments: true } } } });
    if (!post) return notFound();
    await this.audit(this.db, context, 'CONTENT_RIGHTS_READ', 'SourcePost', post.id);
    return post;
  }

  async comments(request: Request, id: string, raw: unknown) {
    const context = await this.auth.context(request);
    if (!await this.db.sourcePost.findFirst({ where: { workspaceId: context.workspaceId, id, deletedAt: null } })) return notFound();
    const page = paginationSchema.parse(raw);
    if (page.cursor && !await this.db.sourceComment.findFirst({ where: { id: page.cursor, workspaceId: context.workspaceId, sourcePostId: id } })) return notFound();
    const items = await this.db.sourceComment.findMany({ where: { workspaceId: context.workspaceId, sourcePostId: id }, orderBy: { id: 'asc' }, take: page.limit + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    await this.audit(this.db, context, 'COMMENTS_READ', 'SourcePost', id);
    return { items: items.slice(0, page.limit), nextCursor: items.length > page.limit ? items[page.limit - 1]?.id ?? null : null };
  }

  async review(request: Request, id: string, raw: unknown) {
    const context = await this.auth.context(request, reviewRoles);
    const input = reviewSchema.parse(raw);
    return this.mutation(request, context, `/posts/${id}/rights/review`, input, async (tx) => {
      const post = await tx.sourcePost.findFirst({ where: { id, workspaceId: context.workspaceId, deletedAt: null }, include: { rights: { orderBy: { createdAt: 'desc' } } } });
      if (!post) return notFound();
      const right = post.rights[0];
      if (!right) throw new ApiError(403, 'BLOCKED_RIGHTS', 'No rights record exists for this content.');
      if (right.reviewStatus !== 'PENDING') throw new ApiError(409, 'INVALID_TRANSITION', 'This rights record has already been reviewed.');
      const updated = { ...right, basis: input.basis ?? right.basis, attested: input.attested ?? right.attested, commercialAllowed: input.commercialAllowed ?? right.commercialAllowed, allowedPlatforms: input.allowedPlatforms ?? right.allowedPlatforms, expiresAt: input.expiresAt === null ? null : input.expiresAt ? new Date(input.expiresAt) : right.expiresAt, attributionRequired: input.attributionRequired ?? right.attributionRequired, evidence: input.evidence ?? right.evidence, territory: input.territory ?? right.territory, attributionText: input.attributionText ?? right.attributionText, reviewStatus: input.decision };
      if (input.decision === 'APPROVED' && right.basis !== updated.basis && !updated.evidence?.trim()) throw new ApiError(403, 'BLOCKED_RIGHTS', 'Changing the rights basis requires explicit supporting evidence.', { blockers: ['EVIDENCE_REQUIRED'] });
      const eligibility = evaluateStoredRights(updated, updated.allowedPlatforms[0] ?? 'YOUTUBE');
      if (input.decision === 'APPROVED' && !eligibility.allowed) throw new ApiError(403, 'BLOCKED_RIGHTS', 'The rights requirements are incomplete.', { blockers: eligibility.reasons });
      await tx.contentRight.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id: right.id } }, data: { basis: updated.basis, attested: updated.attested, commercialAllowed: updated.commercialAllowed, allowedPlatforms: [...new Set(updated.allowedPlatforms)], expiresAt: updated.expiresAt, attributionRequired: updated.attributionRequired, reviewStatus: input.decision, reviewedById: context.userId, reviewedAt: new Date(), evidence: updated.evidence, attributionText: updated.attributionText, territory: updated.territory } });
      const candidate = await tx.contentCandidate.findFirst({ where: { workspaceId: context.workspaceId, sourcePostId: post.id } });
      if (candidate && ['NEEDS_RIGHTS_REVIEW', 'PENDING_REVIEW'].includes(candidate.status)) {
        const nextStatus = input.decision === 'REJECTED' ? 'BLOCKED_RIGHTS' : post.sensitiveFlags.length ? 'BLOCKED_SAFETY' : candidate.score !== null && candidate.score >= candidate.minimumScore ? 'PENDING_REVIEW' : 'BELOW_THRESHOLD';
        await tx.contentCandidate.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id: candidate.id } }, data: { status: nextStatus } });
      }
      await this.audit(tx, context, `RIGHTS_${input.decision}`, 'ContentRight', right.id, { previousBasis: right.basis, basis: updated.basis });
      await this.event(tx, context, `RIGHTS_${input.decision}`, post.id);
      return { postId: post.id, reviewStatus: input.decision };
    });
  }

  async eligibility(request: Request, id: string, raw: unknown) {
    const context = await this.auth.context(request);
    const input = eligibilitySchema.parse(raw);
    const post = await this.db.sourcePost.findFirst({ where: { workspaceId: context.workspaceId, id, deletedAt: null }, include: { rights: { orderBy: { createdAt: 'desc' } } } });
    if (!post) return notFound();
    return evaluateStoredRights(post.rights[0], input.platform);
  }

  async takedown(request: Request, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const input = takedownSchema.parse(raw);
    return this.mutation(request, context, '/takedowns', input, async (tx) => {
      const post = await tx.sourcePost.findFirst({ where: { id: input.postId, workspaceId: context.workspaceId } });
      if (!post) return notFound();
      await tx.sourceComment.deleteMany({ where: { workspaceId: context.workspaceId, sourcePostId: post.id } });
      await tx.contentRight.updateMany({ where: { workspaceId: context.workspaceId, sourcePostId: post.id }, data: { reviewStatus: 'BLOCKED', revokedAt: new Date(), evidence: null, attributionText: null, evidenceAssetId: null } });
      await tx.sourcePost.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id: post.id } }, data: { body: '[removed]', title: null, authorAlias: null, canonicalUrl: 'https://example.invalid/removed', deletedAt: post.deletedAt ?? new Date() } });
      // Derived private text is removed along with its source, even when later phases have created a story.
      await tx.storyVersion.deleteMany({ where: { workspaceId: context.workspaceId, story: { sourcePostId: post.id } } });
      await tx.storyProject.updateMany({ where: { workspaceId: context.workspaceId, sourcePostId: post.id }, data: { status: 'BLOCKED_RIGHTS' } });
      await tx.video.updateMany({ where: { workspaceId: context.workspaceId, story: { sourcePostId: post.id } }, data: { status: 'BLOCKED_RIGHTS', reviewStatus: 'BLOCKED', renderManifest: Prisma.DbNull } });
      await tx.publication.updateMany({ where: { workspaceId: context.workspaceId, video: { story: { sourcePostId: post.id } }, status: { not: 'PUBLISHED' } }, data: { status: 'CANCELLED', errorCode: 'CONTENT_TAKEN_DOWN' } });
      await this.audit(tx, context, 'CONTENT_TAKEN_DOWN', 'SourcePost', post.id, { reasonCode: 'USER_REQUEST' });
      await this.event(tx, context, 'CONTENT_TAKEN_DOWN', post.id);
      return { postId: post.id, removed: true, downstreamRemoteRemoval: 'NEEDS_ACTION' };
    });
  }

  async dashboard(request: Request) {
    const context = await this.auth.context(request);
    const workspaceId = context.workspaceId;
    const [posts, comments, channels, sources, pendingRights, blockedRights] = await Promise.all([
      this.db.sourcePost.count({ where: { workspaceId, deletedAt: null } }), this.db.sourceComment.count({ where: { workspaceId } }),
      this.db.contentChannel.count({ where: { workspaceId } }), this.db.sourceConfig.count({ where: { workspaceId } }),
      this.db.contentRight.count({ where: { workspaceId, reviewStatus: 'PENDING', post: { deletedAt: null } } }),
      this.db.contentRight.count({ where: { workspaceId, OR: [{ basis: 'UNKNOWN' }, { reviewStatus: { in: ['BLOCKED', 'REJECTED'] } }, { revokedAt: { not: null } }, { expiresAt: { lte: new Date() } }] } }),
    ]);
    const [candidates, pendingSources] = await Promise.all([
      this.db.contentCandidate.count({ where: { workspaceId, status: { in: ['PENDING_REVIEW', 'NEEDS_RIGHTS_REVIEW'] } } }),
      this.db.sourceConfig.count({ where: { workspaceId, capabilityStatus: { in: ['NOT_CONFIGURED', 'ACCESS_NOT_APPROVED', 'BLOCKED_EXTERNAL'] } } }),
    ]);
    return { counts: { posts, comments, channels, sources, pendingRights, blockedRights, candidates, pendingSources }, phase: 'PHASE_2', blockers: [
      { code: 'BLOCKED_EXTERNAL', message: 'External source adapters require verified provider approval and remain disabled.' },
      { code: 'NEEDS_ACTION', message: 'TikTok uses manual export and creator handoff.' },
    ], integrations: { sources: 'MANUAL_AND_SYNTHETIC_DEMO', publishing: 'BLOCKED_EXTERNAL', tiktok: 'NEEDS_ACTION' } };
  }

  async auditLogs(request: Request, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const page = paginationSchema.parse(raw);
    if (page.cursor && !await this.db.auditLog.findFirst({ where: { id: page.cursor, workspaceId: context.workspaceId } })) return notFound();
    const items = await this.db.auditLog.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { id: 'desc' }, take: page.limit + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    return { items: items.slice(0, page.limit), nextCursor: items.length > page.limit ? items[page.limit - 1]?.id ?? null : null };
  }

  async publications(request: Request, raw: unknown): Promise<never> {
    const context = await this.auth.context(request, editRoles);
    const input = publicationSchema.parse(raw);
    const video = await this.db.video.findFirst({ where: { workspaceId: context.workspaceId, id: input.videoId }, include: { story: { include: { post: { include: { rights: { orderBy: { createdAt: 'desc' } } } } } } } });
    if (!video) return notFound();
    for (const target of input.targets) {
      const account = await this.db.socialAccount.findFirst({ where: { id: target.socialAccountId, workspaceId: context.workspaceId } });
      if (!account) return notFound();
      const post = video.story?.post;
      const eligibility = post && !post.deletedAt ? evaluateStoredRights(post.rights[0], account.platform) : { allowed: false, reasons: ['UNKNOWN_RIGHTS'] };
      if (!eligibility.allowed) throw new ApiError(403, 'BLOCKED_RIGHTS', 'Publishing is blocked by content rights.', { blockers: eligibility.reasons });
    }
    throw new ApiError(501, 'BLOCKED_PHASE', 'Publication scheduling is not implemented until Phase 4. No job was queued.');
  }
}
