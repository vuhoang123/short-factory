import type { Request } from 'express';
import { Prisma, type PrismaClient } from '@shorts-factory/database';
import { createAnalyticsAdapter, snapshotFreshness, summarizePerformance, type AnalyticsInput, type PerformanceObservation } from '@shorts-factory/analytics';
import { assignExperimentVariant, evaluateExperiment } from '@shorts-factory/automation';
import { performanceObservations, refreshPerformanceRecommendations } from '@shorts-factory/workflows';
import { renderManifestSchema } from '@shorts-factory/media';
import { evaluateRights } from '@shorts-factory/shared';
import { z } from 'zod';
import { AuthService, adminRoles, editRoles } from './auth/auth.service.js';
import { ApiError, notFound } from './errors.js';
import { json, phase5Mutation } from './phase5.common.js';
import { analyticsFilterSchema, assignmentSchema, decisionSchema, experimentSchema, manualMetricSchema } from './phase5.validation.js';

const variantsSchema = experimentSchema.shape.variants;
const publicationSelect = { id: true, status: true, publishedAt: true, createdAt: true, remotePostId: true, remoteUrl: true,
  video: { select: { id: true, title: true, channelId: true, durationMs: true } },
  account: { select: { id: true, displayName: true, platform: true, externalId: true, status: true } },
  metrics: { orderBy: { measuredAt: 'desc' as const }, take: 1 },
} satisfies Prisma.PublicationSelect;
function dateFilter(from?: string, to?: string) { return { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) }; }
function money(value: Prisma.Decimal | null) { return value === null ? null : Number(value); }
function filteredSummary(observations: PerformanceObservation[]) {
  const summaries = summarizePerformance(observations);
  return { summaries, views: summaries.length === 1 ? summaries[0]?.totalViews ?? null : null, engagementRate: summaries.length === 1 ? summaries[0]?.meanEngagementRate ?? null : null };
}

export class AnalyticsService {
  constructor(readonly db: PrismaClient, readonly auth: AuthService) {}

  async overview(request: Request, rawQuery: unknown) {
    const context = await this.auth.context(request);
    const filter = analyticsFilterSchema.parse(rawQuery);
    if (filter.channelId && !await this.db.contentChannel.findFirst({ where: { id: filter.channelId, workspaceId: context.workspaceId }, select: { id: true } })) return notFound();
    const window = dateFilter(filter.from, filter.to);
    const videoWhere = { workspaceId: context.workspaceId, ...(filter.channelId ? { channelId: filter.channelId } : {}), ...(filter.from || filter.to ? { createdAt: window } : {}) };
    const publicationWhere = { workspaceId: context.workspaceId, ...(filter.channelId ? { video: { channelId: filter.channelId } } : {}), ...(filter.platform ? { account: { platform: filter.platform } } : {}), ...(filter.from || filter.to ? { createdAt: window } : {}) };
    const [videos, publications, usages, workflows, allObservations] = await Promise.all([
      this.db.video.findMany({ where: videoWhere, select: { id: true, createdAt: true, mediaAssetId: true }, orderBy: { createdAt: 'desc' }, take: 5000 }),
      this.db.publication.findMany({ where: publicationWhere, select: publicationSelect, orderBy: { createdAt: 'desc' }, take: 5000 }),
      this.db.usageEvent.findMany({ where: { workspaceId: context.workspaceId, ...(filter.channelId ? { channelId: filter.channelId } : {}), ...(filter.from || filter.to ? { occurredAt: window } : {}) }, orderBy: { occurredAt: 'desc' }, take: 10000 }),
      this.db.workflowRun.findMany({ where: { workspaceId: context.workspaceId, entityType: 'AUTOPILOT', ...(filter.channelId ? { entityId: filter.channelId } : {}), ...(filter.from || filter.to ? { createdAt: window } : {}) }, select: { status: true }, take: 5000 }),
      performanceObservations(this.db, context.workspaceId),
    ]);
    const ids = new Set(publications.map((publication) => publication.id));
    const observations = allObservations.filter((observation) => ids.has(observation.publicationId) && (!filter.from || Date.parse(observation.snapshot.observedAt) >= Date.parse(filter.from)) && (!filter.to || Date.parse(observation.snapshot.observedAt) <= Date.parse(filter.to)));
    const aggregate = filteredSummary(observations);
    const blockers: string[] = [];
    if (aggregate.summaries.length > 1) blockers.push('INCOMPATIBLE_METRIC_SCOPES_TOTAL_NOT_COMBINED');
    if (!observations.length) blockers.push('NO_AVAILABLE_METRIC_SNAPSHOTS');
    if (observations.some((observation) => observation.snapshot.synthetic)) blockers.push('SYNTHETIC_TEST_METRICS_INCLUDED_IN_LABELED_COHORTS');
    if (videos.length === 5000 || publications.length === 5000 || usages.length === 10000 || workflows.length === 5000) blockers.push('REPORT_ROW_LIMIT_REACHED_NARROW_DATE_FILTERS');
    const estimatedCostUsd = usages.reduce((sum, usage) => sum + (money(usage.estimatedUsd) ?? 0), 0);
    const billed = usages.flatMap((usage) => usage.billedUsd === null ? [] : [Number(usage.billedUsd)]);
    const points = new Map<string, { date: string; views: number | null; engagement: number | null; produced: number; published: number; failed: number; costUsd: number }>();
    const point = (date: string) => { const key = date.slice(0, 10); const current = points.get(key) ?? { date: key, views: null, engagement: null, produced: 0, published: 0, failed: 0, costUsd: 0 }; points.set(key, current); return current; };
    for (const video of videos) if (video.mediaAssetId) point(video.createdAt.toISOString()).produced += 1;
    for (const publication of publications) {
      if (publication.status === 'PUBLISHED') point((publication.publishedAt ?? publication.createdAt).toISOString()).published += 1;
      if (publication.status.startsWith('FAILED')) point(publication.createdAt.toISOString()).failed += 1;
    }
    for (const usage of usages) point(usage.occurredAt.toISOString()).costUsd += money(usage.estimatedUsd) ?? 0;
    for (const day of [...new Set(observations.map((observation) => observation.snapshot.observedAt.slice(0, 10)))]) {
      const daily = filteredSummary(observations.filter((observation) => observation.snapshot.observedAt.slice(0, 10) === day));
      point(day).views = daily.views; point(day).engagement = daily.engagementRate;
    }
    const content: Array<{ dimension: string; label: string; samples: number; meanViews: number | null }> = [];
    for (const dimension of ['topic', 'source', 'hook', 'template', 'voice', 'subtitle', 'background', 'duration', 'postingWindow']) {
      const labels = [...new Set(observations.flatMap((observation) => observation.dimensions[dimension] ? [observation.dimensions[dimension]!] : []))].sort();
      for (const label of labels) { const items = observations.filter((observation) => observation.dimensions[dimension] === label); const cohorts = summarizePerformance(items); content.push({ dimension, label, samples: items.length, meanViews: cohorts.length === 1 ? cohorts[0]?.meanViews ?? null : null }); }
    }
    const lastSyncedAt = observations.map((observation) => observation.snapshot.observedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
    const finishedPublications = publications.filter((publication) => publication.status === 'PUBLISHED' || publication.status === 'FAILED_PERMANENT').length;
    const finishedWorkflows = workflows.filter((workflow) => ['SUCCEEDED', 'COMPLETED', 'FAILED_PERMANENT'].includes(workflow.status)).length;
    return {
      summary: { produced: videos.filter((video) => video.mediaAssetId).length, published: publications.filter((publication) => publication.status === 'PUBLISHED').length, views: aggregate.views, engagementRate: aggregate.engagementRate,
        publicationSuccessRate: finishedPublications ? publications.filter((publication) => publication.status === 'PUBLISHED').length / finishedPublications : null,
        automationSuccessRate: finishedWorkflows ? workflows.filter((workflow) => ['SUCCEEDED', 'COMPLETED'].includes(workflow.status)).length / finishedWorkflows : null,
        estimatedCostUsd, billedCostUsd: billed.length ? billed.reduce((sum, cost) => sum + cost, 0) : null },
      trend: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byPlatform: (['YOUTUBE', 'FACEBOOK', 'TIKTOK'] as const).flatMap((platform) => { const items = publications.filter((publication) => publication.account.platform === platform); return items.length ? [{ platform, published: items.filter((item) => item.status === 'PUBLISHED').length, views: filteredSummary(observations.filter((observation) => observation.snapshot.platform === platform)).views }] : []; }),
      content, freshness: { lastSyncedAt, stale: !lastSyncedAt || observations.some((observation) => snapshotFreshness(observation.snapshot) !== 'FRESH') }, blockers,
      methodology: 'Latest snapshot per publication. Views are combined only within identical provider, metric definitions and reporting period. Trend view points show observed cumulative/period snapshots, not newly earned daily views. Engagement is the arithmetic mean of available publication rates. Activity and cost dates are UTC. Filters select publication creation dates; snapshot observations must also fall inside the requested dates.',
    };
  }

  async publications(request: Request) {
    const context = await this.auth.context(request);
    return { items: await this.db.publication.findMany({ where: { workspaceId: context.workspaceId }, select: publicationSelect, orderBy: { createdAt: 'desc' }, take: 100 }) };
  }

  async history(request: Request, publicationId: string) {
    const context = await this.auth.context(request);
    if (!await this.db.publication.findFirst({ where: { id: publicationId, workspaceId: context.workspaceId }, select: { id: true } })) return notFound();
    return { items: await this.db.publicationMetric.findMany({ where: { workspaceId: context.workspaceId, publicationId }, orderBy: { measuredAt: 'desc' }, take: 500 }) };
  }

  async refresh(request: Request, publicationId: string) {
    const context = await this.auth.context(request, editRoles);
    return phase5Mutation(this.db, request, context, `/analytics/publications/${publicationId}/refresh`, {}, async (tx) => {
      const publication = await tx.publication.findFirst({ where: { id: publicationId, workspaceId: context.workspaceId }, select: { id: true, remotePostId: true, status: true } });
      if (!publication) return notFound();
      if (publication.status !== 'PUBLISHED' || !publication.remotePostId) throw new ApiError(409, 'METRICS_UNAVAILABLE', 'Refresh requires a confirmed remote publication.');
      const active = await tx.analyticsSyncRun.findFirst({ where: { workspaceId: context.workspaceId, publicationId, status: { in: ['QUEUED', 'RUNNING', 'FAILED_RETRYABLE'] } }, orderBy: { createdAt: 'desc' } });
      if (active) return { syncId: active.id, status: active.status };
      const sync = await tx.analyticsSyncRun.create({ data: { workspaceId: context.workspaceId, publicationId, status: 'QUEUED' } });
      await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, aggregateId: sync.id, eventType: 'ANALYTICS_SYNC_REQUESTED', payload: { entityId: sync.id, workspaceId: context.workspaceId, version: 1 } } });
      return { syncId: sync.id, status: sync.status };
    });
  }

  async manual(request: Request, publicationId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = manualMetricSchema.parse(raw);
    return phase5Mutation(this.db, request, context, `/analytics/publications/${publicationId}/metrics`, input, async (tx) => {
      const publication = await tx.publication.findFirst({ where: { id: publicationId, workspaceId: context.workspaceId }, include: { account: { select: { platform: true, externalId: true } }, video: { select: { durationMs: true } } } });
      if (!publication) return notFound();
      const { observedAt, ...metrics } = input;
      const platform = z.enum(['YOUTUBE', 'FACEBOOK', 'TIKTOK']).parse(publication.account.platform);
      const analyticsInput: AnalyticsInput = { publicationId, platform, remoteId: publication.remotePostId ?? `manual:${publicationId}`, accountExternalId: publication.account.externalId, ...(publication.publishedAt ? { publishedAt: publication.publishedAt.toISOString() } : {}), ...(publication.video.durationMs ? { videoDurationSeconds: publication.video.durationMs / 1000 } : {}), ...(observedAt ? { observedAt } : {}) };
      const snapshot = await createAnalyticsAdapter('manual', { manualMetrics: metrics }).fetchMetrics(analyticsInput);
      const row = await tx.publicationMetric.create({ data: { workspaceId: context.workspaceId, publicationId, measuredAt: new Date(snapshot.observedAt), metrics: json(snapshot) } });
      return { id: row.id, publicationId, snapshot };
    });
  }

  async syncRuns(request: Request) {
    const context = await this.auth.context(request);
    return { items: await this.db.analyticsSyncRun.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  }

  async recommendations(request: Request) {
    const context = await this.auth.context(request);
    return { items: await this.db.performanceRecommendation.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  }

  async refreshRecommendations(request: Request) {
    const context = await this.auth.context(request, editRoles);
    return phase5Mutation(this.db, request, context, '/analytics/recommendations/refresh', {}, async (tx) => ({ count: await refreshPerformanceRecommendations(tx, context.workspaceId) }));
  }

  async decideRecommendation(request: Request, recommendationId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = decisionSchema.parse(raw);
    return phase5Mutation(this.db, request, context, `/analytics/recommendations/${recommendationId}/decision`, input, async (tx) => {
      const recommendation = await tx.performanceRecommendation.findFirst({ where: { id: recommendationId, workspaceId: context.workspaceId } });
      if (!recommendation) return notFound();
      if (recommendation.status !== 'PENDING') throw new ApiError(409, 'RECOMMENDATION_ALREADY_DECIDED', 'This recommendation already has a recorded decision.');
      return tx.performanceRecommendation.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id: recommendationId } }, data: { status: input.decision, decidedAt: new Date() } });
    });
  }

  async experiments(request: Request) {
    const context = await this.auth.context(request);
    const [experiments, observations] = await Promise.all([
      this.db.experiment.findMany({ where: { workspaceId: context.workspaceId }, include: { assignments: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      performanceObservations(this.db, context.workspaceId),
    ]);
    const publications = await this.db.publication.findMany({ where: { workspaceId: context.workspaceId, videoId: { in: experiments.flatMap((experiment) => experiment.assignments.map((assignment) => assignment.videoId)) } }, select: { id: true, videoId: true } });
    return { items: experiments.map((experiment) => {
      const variants = variantsSchema.parse(experiment.variants);
      const assignedIds = new Set(experiment.assignments.map((assignment) => assignment.videoId));
      const cohort = observations.filter((observation) => publications.some((publication) => publication.id === observation.publicationId && assignedIds.has(publication.videoId)));
      const summaries = summarizePerformance(cohort);
      const compatible = summaries.length <= 1;
      const results = evaluateExperiment(experiment.assignments.map((assignment) => {
        const observationsForVideo = cohort.filter((observation) => publications.some((publication) => publication.id === observation.publicationId && publication.videoId === assignment.videoId));
        return { contentId: assignment.sourcePostId, variantId: assignment.variantId, value: compatible && observationsForVideo.length === 1 ? observationsForVideo[0]?.snapshot.metrics.views ?? null : null };
      }), variants.map((variant) => variant.id), experiment.minSamples);
      return { ...experiment, results: { ...results, blockers: compatible ? [] : ['INCOMPATIBLE_METRIC_SCOPES'] } };
    }) };
  }

  async createExperiment(request: Request, raw: unknown) {
    const context = await this.auth.context(request, adminRoles);
    const input = experimentSchema.parse(raw);
    return phase5Mutation(this.db, request, context, '/analytics/experiments', input, async (tx) => {
      if (!await tx.contentChannel.findFirst({ where: { id: input.channelId, workspaceId: context.workspaceId }, select: { id: true } })) return notFound();
      return tx.experiment.create({ data: { workspaceId: context.workspaceId, ...input, variants: json(input.variants), status: 'PENDING_APPROVAL' } });
    });
  }

  async approveExperiment(request: Request, experimentId: string) {
    const context = await this.auth.context(request, adminRoles);
    return phase5Mutation(this.db, request, context, `/analytics/experiments/${experimentId}/approve`, {}, async (tx) => {
      const experiment = await tx.experiment.findFirst({ where: { id: experimentId, workspaceId: context.workspaceId } });
      if (!experiment) return notFound();
      if (experiment.status !== 'PENDING_APPROVAL') throw new ApiError(409, 'EXPERIMENT_ALREADY_REVIEWED', 'This experiment is no longer awaiting approval.');
      return tx.experiment.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id: experimentId } }, data: { status: 'APPROVED' } });
    });
  }

  async assignExperiment(request: Request, experimentId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = assignmentSchema.parse(raw);
    return phase5Mutation(this.db, request, context, `/analytics/experiments/${experimentId}/assign`, input, async (tx) => {
      const experiment = await tx.experiment.findFirst({ where: { id: experimentId, workspaceId: context.workspaceId } });
      if (!experiment) return notFound();
      if (experiment.status !== 'APPROVED') throw new ApiError(409, 'EXPERIMENT_APPROVAL_REQUIRED', 'Approve the hypothesis and variants before assigning content.');
      const video = await tx.video.findFirst({ where: { id: input.videoId, workspaceId: context.workspaceId, channelId: experiment.channelId }, include: { productionRun: true, story: { include: { post: { include: { rights: { orderBy: { createdAt: 'desc' }, take: 1 } } } } } } });
      if (!video?.story || !video.mediaAssetId || video.reviewStatus !== 'APPROVED' || video.story.post.deletedAt || video.story.post.sensitiveFlags.length) throw new ApiError(409, 'EXPERIMENT_VIDEO_INELIGIBLE', 'Choose a completed, approved video from this channel with an available source.');
      const right = video.story.post.rights[0];
      if (!right || !right.allowedPlatforms.some((platform) => evaluateRights(right, platform).eligible)) throw new ApiError(409, 'BLOCKED_RIGHTS', 'Current source rights must permit this experiment content.');
      const existing = await tx.experimentAssignment.findFirst({ where: { workspaceId: context.workspaceId, experimentId, sourcePostId: video.story.sourcePostId } });
      if (existing) { if (existing.videoId !== video.id) throw new ApiError(409, 'EXPERIMENT_CONTENT_REUSED', 'Each source story can be assigned only once in this experiment.'); return existing; }
      const variants = variantsSchema.parse(experiment.variants);
      const variantId = assignExperimentVariant(experimentId, video.story.sourcePostId, variants.map((variant) => variant.id));
      const manifest = renderManifestSchema.safeParse(video.renderManifest);
      const variant = variants.find((candidate) => candidate.id === variantId);
      if (experiment.dimension === 'template' && variant?.config.templateId && (!manifest.success || manifest.data.templateId !== variant.config.templateId)) throw new ApiError(409, 'EXPERIMENT_VARIANT_MISMATCH', 'This source is assigned to a different template variant. Apply its configuration before adding the video.');
      if (experiment.dimension === 'subtitle' && variant?.config.subtitlePreset && (!manifest.success || manifest.data.subtitlePreset !== variant.config.subtitlePreset)) throw new ApiError(409, 'EXPERIMENT_VARIANT_MISMATCH', 'Apply the assigned subtitle configuration before adding the video.');
      const production = z.object({ voiceProfileId: z.string().optional() }).safeParse(video.productionRun?.input);
      if (experiment.dimension === 'voice' && variant?.config.voiceProfileId && (!production.success || production.data.voiceProfileId !== variant.config.voiceProfileId)) throw new ApiError(409, 'EXPERIMENT_VARIANT_MISMATCH', 'Apply the assigned voice configuration before adding the video.');
      if (experiment.dimension === 'hook' && variant?.config.text && (!manifest.success || manifest.data.visualSegments.find((segment) => segment.type === 'HOOK')?.text !== variant.config.text)) throw new ApiError(409, 'EXPERIMENT_VARIANT_MISMATCH', 'Apply the assigned hook text before adding the video.');
      return tx.experimentAssignment.create({ data: { workspaceId: context.workspaceId, experimentId, sourcePostId: video.story.sourcePostId, videoId: video.id, variantId } });
    });
  }
}
