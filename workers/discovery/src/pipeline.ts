import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@shorts-factory/database';
import { canonicalUrlSchema, jobEnvelopeSchema, normalizeText, redactPersonalData, type NormalizedPost, type SourcePlatform } from '@shorts-factory/shared';
import { createSourceAdapter, detectSensitiveFlags, scoreContent, type ContentScore } from '@shorts-factory/sources';
import { z } from 'zod';
import type { WorkerConfig } from './config.js';

const postSchema = z.object({
  platform: z.enum(['MANUAL', 'REDDIT', 'THREADS', 'FACEBOOK']), externalId: z.string().trim().min(1).max(200),
  canonicalUrl: canonicalUrlSchema, title: z.string().max(500).optional(), text: z.string().min(1).max(50000),
  authorAlias: z.string().max(200).optional(), language: z.string().max(20).optional(), topicTags: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  synthetic: z.boolean().optional(), rawPayload: z.record(z.string(), z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])).optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(), fetchedAt: z.string().datetime({ offset: true }),
  metrics: z.object({ likes: z.number().int().nonnegative().optional(), comments: z.number().int().nonnegative().optional(), shares: z.number().int().nonnegative().optional(), views: z.number().int().nonnegative().optional() }).strict(),
}).strict();
const commentSchema = z.object({ externalId: z.string().trim().min(1).max(200), parentExternalId: z.string().trim().max(200).optional(), text: z.string().trim().min(1).max(10000), likes: z.number().int().nonnegative().optional(), publishedAt: z.string().datetime({ offset: true }).optional() }).strict();
const configSchema = z.object({ mode: z.enum(['USER_SUPPLIED', 'MOCK_FIXTURE']).optional(), keywords: z.array(z.string().max(80)).max(100).default([]), hashtags: z.array(z.string().max(80)).max(100).default([]), topics: z.array(z.string().max(80)).max(100).default([]), language: z.string().max(20).optional(), retainRawPayload: z.boolean().default(false) }).passthrough();
const topicConfigSchema = z.object({ keywords: z.array(z.string().max(80)).optional(), allow: z.array(z.string().max(80)).optional(), deny: z.array(z.string().max(80)).optional() }).passthrough();
const sourceCommentsSchema = z.object({ comments: z.array(commentSchema).max(500) });
const knownSteps = new Set(['SOURCE_SYNC_REQUESTED', 'SOURCE_POST_IMPORTED']);

export interface DiscoveryEnvelope {
  jobId: string;
  workspaceId: string;
  entityId: string;
  step: string;
  version: number;
  idempotencyKey: string;
  traceId: string;
  attempt: number;
  scheduledAt: string;
}

function asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeTerms(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap(group => group ?? []).map(term => term.trim()).filter(Boolean))];
}

function hash(title: string | null, body: string): string {
  return createHash('sha256').update(JSON.stringify([normalizeText(title ?? ''), normalizeText(body)])).digest('hex');
}

function cleanedUrl(input: string): string {
  const url = new URL(input);
  url.search = '';
  url.hash = '';
  return canonicalUrlSchema.parse(url.toString());
}

function cleanText(input: string): string { return redactPersonalData(normalizeText(input)); }

function jsonSafe(value: ContentScore): Prisma.InputJsonValue {
  return { score: value.score, factors: { engagementVelocity: value.factors.engagementVelocity, hookCuriosity: value.factors.hookCuriosity, commentQuality: value.factors.commentQuality, topicRelevance: value.factors.topicRelevance, shortVideoSuitability: value.factors.shortVideoSuitability }, matchedTopics: value.matchedTopics, modelVersion: value.modelVersion, reasoning: value.reasoning };
}

export class DiscoveryPipeline {
  constructor(readonly db: PrismaClient, readonly config: WorkerConfig) {}

  async process(raw: unknown, attemptsMade = 0, maxAttempts = this.config.DISCOVERY_RETRY_ATTEMPTS): Promise<void> {
    const job = jobEnvelopeSchema.parse(raw) as DiscoveryEnvelope;
    if (!knownSteps.has(job.step)) throw new Error('UNSUPPORTED_DISCOVERY_EVENT');
    if (job.step === 'SOURCE_SYNC_REQUESTED') {
      try { await this.sync(job.workspaceId, job.entityId); }
      catch (error) {
        const code = this.safeErrorCode(error);
        await this.db.$transaction(async tx => {
          const run = await tx.sourceSyncRun.findFirst({ where: { id: job.entityId, workspaceId: job.workspaceId }, select: { sourceConfigId: true } });
          if (!run) return;
          const terminal = attemptsMade + 1 >= maxAttempts;
          const status = terminal ? 'FAILED' : 'RETRYING';
          const now = new Date();
          await tx.sourceSyncRun.update({ where: { workspaceId_id: { workspaceId: job.workspaceId, id: job.entityId } }, data: { status, attempts: attemptsMade + 1, errorCode: code, ...(terminal ? { finishedAt: now } : {}) } });
          await tx.sourceConfig.updateMany({ where: { id: run.sourceConfigId, workspaceId: job.workspaceId }, data: { lastSyncStatus: status, lastErrorCode: code, lastErrorAt: now, ...(terminal ? { lastSyncAt: now } : {}) } });
        });
        throw new Error(code);
      }
      return;
    }
    await this.scoreImportedPost(job.workspaceId, job.entityId);
  }

  private safeErrorCode(error: unknown): string {
    if (error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)) return error.message;
    return 'DISCOVERY_PROCESSING_FAILED';
  }

  private async sync(workspaceId: string, runId: string): Promise<void> {
    const run = await this.db.sourceSyncRun.findFirst({ where: { id: runId, workspaceId }, include: { source: true } });
    if (!run) return;
    const source = run.source;
    const sourceConfig = configSchema.parse(asObject(source.config));
    if (!source.enabled) throw new Error('SOURCE_DISABLED');
    if (source.platform !== 'MANUAL' || sourceConfig.mode !== 'MOCK_FIXTURE' || process.env.NODE_ENV === 'production') throw new Error('BLOCKED_EXTERNAL');

    const adapter = createSourceAdapter(source.platform as SourcePlatform, source.config);
    const access = await adapter.validateAccess();
    if (!access.available) throw new Error(access.status);
    const query = { keywords: sourceConfig.keywords, hashtags: sourceConfig.hashtags, topics: sourceConfig.topics, ...(sourceConfig.language ? { language: sourceConfig.language } : {}), limit: this.config.DISCOVERY_PAGE_SIZE };
    const startedAt = new Date();
    await this.db.$transaction(async tx => {
      await tx.sourceSyncRun.update({ where: { workspaceId_id: { workspaceId, id: runId } }, data: { status: 'RUNNING', attempts: run.attempts + 1, startedAt, errorCode: null } });
      await tx.sourceConfig.update({ where: { workspaceId_id: { workspaceId, id: source.id } }, data: { lastSyncStatus: 'RUNNING', lastErrorCode: null, lastErrorAt: null } });
    });

    let cursor: string | undefined = run.cursor ?? undefined;
    const seenCursors = new Set<string>();
    let fetchedCount = 0;
    let duplicateCount = 0;
    let pageCount = 0;
    do {
      if (pageCount >= this.config.DISCOVERY_MAX_PAGES) break;
      if (cursor && seenCursors.has(cursor)) throw new Error('PAGINATION_CURSOR_LOOP');
      if (cursor) seenCursors.add(cursor);
      const page = await adapter.discover({ ...query, ...(cursor ? { cursor } : {}) });
      for (const post of page.posts) {
        const result = await this.persistPost(workspaceId, source.id, source.channelId, source.config, runId, post, adapter, sourceConfig.retainRawPayload);
        fetchedCount += result.fetched ? 1 : 0;
        duplicateCount += result.duplicate ? 1 : 0;
      }
      pageCount += 1;
      cursor = page.nextCursor;
      await this.db.sourceSyncRun.update({ where: { workspaceId_id: { workspaceId, id: runId } }, data: { cursor: cursor ?? null, nextCursor: cursor ?? null, fetchedCount, duplicateCount } });
      if (cursor && pageCount < this.config.DISCOVERY_MAX_PAGES && this.config.DISCOVERY_PAGE_DELAY_MS > 0) await new Promise(resolve => setTimeout(resolve, this.config.DISCOVERY_PAGE_DELAY_MS));
    } while (cursor);

    const finishedAt = new Date();
    const syncStatus = cursor ? 'PARTIAL' : 'SUCCEEDED';
    await this.db.$transaction(async tx => {
      await tx.sourceSyncRun.update({ where: { workspaceId_id: { workspaceId, id: runId } }, data: { status: syncStatus, fetchedCount, duplicateCount, nextCursor: cursor ?? null, finishedAt, errorCode: null } });
      await tx.sourceConfig.update({ where: { workspaceId_id: { workspaceId, id: source.id } }, data: { lastSyncStatus: syncStatus, lastSyncAt: finishedAt, lastErrorCode: null, lastErrorAt: null } });
    });
  }

  private async persistPost(workspaceId: string, sourceId: string, channelId: string | null, sourceConfigRaw: Prisma.JsonValue, runId: string, rawPost: NormalizedPost, adapter: ReturnType<typeof createSourceAdapter>, retainRawPayload: boolean) {
    const post = postSchema.parse(rawPost);
    if (post.platform !== adapter.platform) throw new Error('ADAPTER_PLATFORM_MISMATCH');
    const title = post.title ? cleanText(post.title) : null;
    const body = cleanText(post.text);
    if (!body) throw new Error('EMPTY_NORMALIZED_POST');
    const canonicalUrl = cleanedUrl(post.canonicalUrl);
    const contentHash = hash(title, body);
    const comments = this.config.DISCOVERY_COMMENT_LIMIT ? sourceCommentsSchema.parse({ comments: await adapter.getComments(post.externalId, this.config.DISCOVERY_COMMENT_LIMIT) }).comments : [];
    const normalizedComments = comments.map(comment => {
      const text = cleanText(comment.text);
      return { ...comment, text, sensitiveFlags: [...new Set(detectSensitiveFlags(text))] };
    });
    const currentMetrics = post.metrics;

    return this.db.$transaction(async tx => {
      const existing = await tx.sourcePost.findFirst({ where: { workspaceId, platform: post.platform, OR: [{ externalPostId: post.externalId }, { contentHash }] }, include: { metricSnapshots: { orderBy: { measuredAt: 'desc' }, take: 1 } } });
      if (existing?.deletedAt) throw new Error('SOURCE_POST_REMOVED');
      if (existing && existing.externalPostId !== post.externalId) return { fetched: false, duplicate: true };
      const previous = existing?.metricSnapshots[0];
      const record = existing ?? await tx.sourcePost.create({ data: {
        workspaceId, sourceConfigId: sourceId, channelId, platform: post.platform, externalPostId: post.externalId,
        canonicalUrl, title, body, authorAlias: post.authorAlias ? cleanText(post.authorAlias).slice(0, 200) : null,
        language: post.language ?? null, topicTags: post.topicTags ?? [], contentHash,
        rawPayload: post.synthetic && retainRawPayload && post.rawPayload ? post.rawPayload as Prisma.InputJsonValue : Prisma.DbNull,
        synthetic: post.synthetic ?? false, sensitiveFlags: [...new Set(detectSensitiveFlags(`${title ?? ''}\n${body}`))],
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null, discoveredAt: new Date(post.fetchedAt),
      } });
      if (!existing) await tx.contentRight.create({ data: { workspaceId, sourcePostId: record.id, basis: 'UNKNOWN', attested: false, commercialAllowed: false, allowedPlatforms: [], territory: 'UNSPECIFIED', reviewStatus: 'PENDING' } });
      if (normalizedComments.length) await tx.sourceComment.createMany({
        data: normalizedComments.map(comment => ({ workspaceId, sourcePostId: record.id, externalId: comment.externalId, parentExternalId: comment.parentExternalId ?? null, body: comment.text, sensitiveFlags: comment.sensitiveFlags, likes: comment.likes ?? null, publishedAt: comment.publishedAt ? new Date(comment.publishedAt) : null })),
        skipDuplicates: true,
      });
      await tx.postMetricSnapshot.create({ data: { workspaceId, sourcePostId: record.id, sourceSyncRunId: runId, measuredAt: new Date(post.fetchedAt), likes: currentMetrics.likes ?? null, replies: currentMetrics.comments ?? null, shares: currentMetrics.shares ?? null, views: currentMetrics.views ?? null } });
      await this.scoreCandidate(tx, workspaceId, record.id, sourceConfigRaw, previous ? { likes: previous.likes, comments: previous.replies, shares: previous.shares, views: previous.views } : undefined, previous?.measuredAt);
      return { fetched: !existing, duplicate: existing !== null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async scoreImportedPost(workspaceId: string, postId: string): Promise<void> {
    await this.db.$transaction(async tx => {
      const post = await tx.sourcePost.findFirst({ where: { id: postId, workspaceId, deletedAt: null }, select: { id: true, sourceConfigId: true } });
      if (!post) return;
      const source = post.sourceConfigId ? await tx.sourceConfig.findFirst({ where: { id: post.sourceConfigId, workspaceId }, select: { config: true } }) : null;
      await this.scoreCandidate(tx, workspaceId, post.id, source?.config ?? {});
    });
  }

  private async scoreCandidate(tx: Prisma.TransactionClient, workspaceId: string, postId: string, sourceConfigRaw: Prisma.JsonValue | null, previousMetrics?: { likes: number | null; comments: number | null; shares: number | null; views: number | null }, previousMeasuredAt?: Date) {
    const post = await tx.sourcePost.findFirst({ where: { id: postId, workspaceId, deletedAt: null }, include: { comments: { select: { body: true, likes: true, sensitiveFlags: true } }, rights: { orderBy: { createdAt: 'desc' }, take: 1 }, metricSnapshots: { orderBy: { measuredAt: 'desc' }, take: 1 }, channel: { select: { topicConfig: true, minimumCandidateScore: true, topicRules: { where: { enabled: true }, select: { keywords: true, hashtags: true, topics: true, language: true, allow: true, deny: true, minimumScore: true } } } } } });
    if (!post) return;
    const sourceConfig = configSchema.parse(asObject(sourceConfigRaw));
    const channelConfig = topicConfigSchema.parse(asObject(post.channel?.topicConfig));
    const rules = post.channel?.topicRules ?? [];
    const topics = safeTerms(sourceConfig.keywords, sourceConfig.hashtags, sourceConfig.topics, channelConfig.keywords, channelConfig.allow, ...rules.map(rule => [...rule.keywords, ...rule.hashtags, ...rule.topics, ...rule.allow]));
    const denyTerms = safeTerms(channelConfig.deny, ...rules.map(rule => rule.deny));
    const lowerText = `${post.title ?? ''} ${post.body}`.toLocaleLowerCase();
    const denied = denyTerms.some(term => lowerText.includes(term.toLocaleLowerCase()));
    const current = post.metricSnapshots[0];
    const score = scoreContent({
      post: { title: post.title ?? undefined, text: post.body, publishedAt: post.publishedAt?.toISOString(), topicTags: post.topicTags, metrics: { likes: current?.likes ?? undefined, comments: current?.replies ?? undefined, shares: current?.shares ?? undefined, views: current?.views ?? undefined } },
      comments: post.comments.map(comment => ({ text: comment.body, likes: comment.likes ?? undefined })), topicTerms: topics,
      ...(previousMetrics && previousMeasuredAt ? { previousMetrics: { likes: previousMetrics.likes ?? undefined, comments: previousMetrics.comments ?? undefined, shares: previousMetrics.shares ?? undefined, views: previousMetrics.views ?? undefined }, previousMeasuredAt, now: current?.measuredAt ?? new Date() } : {}),
    });
    const threshold = Math.max(post.channel?.minimumCandidateScore ?? 55, ...rules.map(rule => rule.minimumScore));
    const rights = post.rights[0];
    const safetyFlags = [...new Set([...post.sensitiveFlags, ...post.comments.flatMap(comment => comment.sensitiveFlags)])];
    const rightsPending = !rights || rights.reviewStatus !== 'APPROVED' || rights.basis === 'UNKNOWN' || !rights.attested || rights.revokedAt !== null;
    const status = safetyFlags.length || denied ? 'BLOCKED_SAFETY' : rightsPending ? 'NEEDS_RIGHTS_REVIEW' : score.score >= threshold ? 'PENDING_REVIEW' : 'BELOW_THRESHOLD';
    const eligibility = { rightsStatus: rights?.reviewStatus ?? 'MISSING', rightsBasis: rights?.basis ?? 'UNKNOWN', rightsPending, safetyFlags, deniedByTopicRule: denied, score: score.score, minimumScore: threshold, eligible: status === 'PENDING_REVIEW' };
    const data = { score: score.score, factors: jsonSafe(score), modelVersion: score.modelVersion, reasoning: score.reasoning, eligibility, minimumScore: threshold, scoredAt: new Date() };
    const existing = await tx.contentCandidate.findFirst({ where: { workspaceId, sourcePostId: postId } });
    if (!existing) {
      await tx.contentCandidate.create({ data: { workspaceId, sourcePostId: postId, ...data, status } });
      return;
    }
    const terminal = ['APPROVED', 'REJECTED', 'BLOCKED_RIGHTS', 'BLOCKED_SAFETY', 'DUPLICATE'].includes(existing.status);
    await tx.contentCandidate.update({ where: { workspaceId_id: { workspaceId, id: existing.id } }, data: { ...data, ...(terminal ? {} : { status }) } });
  }
}
