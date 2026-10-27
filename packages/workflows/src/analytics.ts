import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@shorts-factory/database';
import { AnalyticsError, analyticsProviderSchema, analyticsSnapshotSchema, createAnalyticsAdapter, recommendPerformance, type AnalyticsAdapterOptions, type AnalyticsInput, type PerformanceObservation } from '@shorts-factory/analytics';
import { renderManifestSchema } from '@shorts-factory/media';
import { z } from 'zod';

function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
const flagsSchema = z.object({ analyticsProvider: analyticsProviderSchema.optional(), analyticsApproved: z.boolean().optional(), scopes: z.array(z.string()).optional(), graphApiVersion: z.string().optional(), facebookMetrics: z.unknown().optional() });
const configSchema = z.object({ ANALYTICS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3), ANALYTICS_RETRY_SECONDS: z.coerce.number().int().min(1).max(3600).default(60), ANALYTICS_MIN_SAMPLES: z.coerce.number().int().min(3).max(10000).default(5), ANALYTICS_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(3650).default(30) });

export async function processAnalyticsSync(db: PrismaClient, workspaceId: string, syncId: string): Promise<void> {
  const config = configSchema.parse(process.env);
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 60_000);
  await db.analyticsSyncRun.updateMany({ where: { id: syncId, workspaceId, status: 'RUNNING', attempts: { gte: config.ANALYTICS_MAX_ATTEMPTS }, leaseUntil: { lt: now } }, data: { status: 'FAILED_PERMANENT', errorCode: 'ATTEMPTS_EXHAUSTED', leaseUntil: null, nextRunAt: null, completedAt: now } });
  const claim = await db.analyticsSyncRun.updateMany({ where: { id: syncId, workspaceId, attempts: { lt: config.ANALYTICS_MAX_ATTEMPTS }, OR: [
    { status: 'QUEUED' },
    { status: 'FAILED_RETRYABLE', OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
    { status: 'RUNNING', leaseUntil: { lt: now } },
  ] }, data: { status: 'RUNNING', attempts: { increment: 1 }, leaseUntil, errorCode: null } });
  if (!claim.count) return;
  const run = await db.analyticsSyncRun.findFirst({ where: { id: syncId, workspaceId, status: 'RUNNING', leaseUntil }, include: { publication: { include: { account: true, video: true } } } });
  if (!run) return;
  const fence = { id: run.id, workspaceId, status: 'RUNNING', attempts: run.attempts, leaseUntil };
  try {
    const publication = run.publication;
    if (publication.status !== 'PUBLISHED' || !publication.remotePostId) throw new AnalyticsError('METRICS_UNAVAILABLE');
    const parsedFlags = flagsSchema.safeParse(publication.account.capabilityFlags ?? {});
    if (!parsedFlags.success) throw new AnalyticsError('BLOCKED_EXTERNAL');
    const flags = parsedFlags.data;
    const platform = z.enum(['YOUTUBE', 'FACEBOOK', 'TIKTOK']).parse(publication.account.platform);
    const provider = flags.analyticsProvider ?? analyticsProviderSchema.parse(platform.toLowerCase());
    if (provider === 'manual') throw new AnalyticsError('METRICS_UNAVAILABLE');
    const secretRef = publication.account.secretRef;
    const accessToken = secretRef && /^env:ANALYTICS_TOKEN_[A-Z0-9_]+$/.test(secretRef) ? process.env[secretRef.slice(4)] : undefined;
    const options: AnalyticsAdapterOptions = { accessToken, approved: flags.analyticsApproved === true && publication.account.status === 'CONNECTED', grantedScopes: flags.scopes ?? [], liveEnabled: process.env.ANALYTICS_LIVE_ENABLED === 'true', apiVersion: flags.graphApiVersion };
    if (flags.facebookMetrics) options.facebookMetrics = flags.facebookMetrics as AnalyticsAdapterOptions['facebookMetrics'];
    const adapter = createAnalyticsAdapter(provider, options);
    const input: AnalyticsInput = { publicationId: publication.id, platform, remoteId: publication.remotePostId, accountExternalId: publication.account.externalId, ...(publication.publishedAt ? { publishedAt: publication.publishedAt.toISOString() } : {}), ...(publication.video.durationMs ? { videoDurationSeconds: publication.video.durationMs / 1000 } : {}) };
    if (provider === 'youtube') { input.endDate = now.toISOString().slice(0, 10); input.startDate = new Date(now.getTime() - config.ANALYTICS_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10); }
    const snapshot = analyticsSnapshotSchema.parse(await adapter.fetchMetrics(input));
    await db.$transaction(async (tx) => {
      const completed = await tx.analyticsSyncRun.updateMany({ where: fence, data: { status: 'SUCCEEDED', completedAt: new Date(), leaseUntil: null, nextRunAt: null } });
      if (!completed.count) return;
      await tx.publicationMetric.create({ data: { workspaceId, publicationId: publication.id, measuredAt: new Date(snapshot.observedAt), metrics: json(snapshot) } });
      await tx.auditLog.create({ data: { workspaceId, action: 'ANALYTICS_SYNC_SUCCEEDED', resourceType: 'AnalyticsSyncRun', resourceId: syncId, metadata: { provider, publicationId: publication.id, synthetic: snapshot.synthetic } } });
    });
    await refreshPerformanceRecommendations(db, workspaceId);
  } catch (error) {
    const known = error instanceof AnalyticsError ? error : new AnalyticsError('PROVIDER_RESPONSE_INVALID');
    const retry = known.retryable && run.attempts < config.ANALYTICS_MAX_ATTEMPTS;
    const delaySeconds = Math.max(known.retryAfterSeconds ?? 0, config.ANALYTICS_RETRY_SECONDS * 2 ** (run.attempts - 1));
    await db.analyticsSyncRun.updateMany({ where: fence, data: { status: retry ? 'FAILED_RETRYABLE' : known.code === 'BLOCKED_EXTERNAL' || known.code === 'TOKEN_EXPIRED' ? 'BLOCKED_EXTERNAL' : 'FAILED_PERMANENT', errorCode: known.code, leaseUntil: null, nextRunAt: retry ? new Date(Date.now() + delaySeconds * 1000) : null, completedAt: retry ? null : new Date() } });
  }
}

export async function performanceObservations(db: Pick<PrismaClient, 'publication'>, workspaceId: string): Promise<PerformanceObservation[]> {
  const publications = await db.publication.findMany({ where: { workspaceId, status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' }, take: 5000, include: { metrics: { orderBy: { measuredAt: 'desc' }, take: 1 }, account: { select: { platform: true } }, video: { include: { productionRun: true, story: { include: { post: true } } } } } });
  return publications.flatMap((publication) => {
    const metric = publication.metrics[0];
    if (!metric) return [];
    const parsed = analyticsSnapshotSchema.safeParse(metric.metrics);
    if (!parsed.success || parsed.data.publicationId !== publication.id) return [];
    const manifest = renderManifestSchema.safeParse(publication.video.renderManifest);
    const production = z.object({ voiceProfileId: z.string().optional(), backgroundCategory: z.string().optional(), style: z.string().optional() }).safeParse(publication.video.productionRun?.input);
    const dimensions: Record<string, string> = { channel: publication.video.channelId, platform: publication.account.platform };
    if (manifest.success) { dimensions.template = manifest.data.templateId; dimensions.subtitle = manifest.data.subtitlePreset; dimensions.hook = manifest.data.visualSegments.find((segment) => segment.type === 'HOOK')?.narrationType ?? 'UNKNOWN'; }
    if (production.success && production.data.voiceProfileId) dimensions.voice = production.data.voiceProfileId;
    if (production.success && production.data.backgroundCategory) dimensions.background = production.data.backgroundCategory;
    if (publication.video.durationMs) dimensions.duration = `${Math.floor(publication.video.durationMs / 15000) * 15}–${Math.floor(publication.video.durationMs / 15000) * 15 + 15} sec`;
    if (publication.video.story?.post) { dimensions.source = publication.video.story.post.platform; const topic = publication.video.story.post.topicTags[0]; if (topic) dimensions.topic = topic; }
    if (publication.publishedAt) dimensions.postingWindow = `${String(publication.publishedAt.getUTCHours()).padStart(2, '0')}:00 UTC`;
    return [{ snapshotId: metric.id, publicationId: publication.id, snapshot: parsed.data, dimensions }];
  });
}

export async function refreshPerformanceRecommendations(db: Pick<PrismaClient, 'publication' | 'performanceRecommendation'>, workspaceId: string): Promise<number> {
  const config = configSchema.parse(process.env);
  const observations = await performanceObservations(db, workspaceId);
  const channels = [...new Set(observations.map((observation) => observation.dimensions.channel))];
  let count = 0;
  for (const channelId of channels) {
    const recommendations = recommendPerformance(observations.filter((observation) => observation.dimensions.channel === channelId), config.ANALYTICS_MIN_SAMPLES);
    for (const recommendation of recommendations) {
      const key = createHash('sha256').update(JSON.stringify([channelId, recommendation.algorithmVersion, recommendation.dimension, recommendation.value, recommendation.comparisonKey, [...recommendation.evidenceIds].sort()])).digest('hex');
      await db.performanceRecommendation.upsert({ where: { workspaceId_key: { workspaceId, key } }, create: { workspaceId, key, algorithmVersion: recommendation.algorithmVersion, kind: recommendation.kind, title: recommendation.title, explanation: recommendation.explanation, evidence: json({ channelId, ...recommendation }) }, update: {} });
      count += 1;
    }
  }
  return count;
}
