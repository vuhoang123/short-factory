import { createHash } from 'node:crypto';
import { z } from 'zod';

export const metricNames = ['views', 'likes', 'comments', 'shares', 'watchTimeSeconds', 'averageViewDurationSeconds', 'retentionRate', 'engagementRate'] as const;
export type MetricName = typeof metricNames[number];
export const analyticsMetricsSchema = z.object({
  views: z.number().int().nonnegative().nullable(), likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(), shares: z.number().int().nonnegative().nullable(),
  watchTimeSeconds: z.number().nonnegative().nullable(), averageViewDurationSeconds: z.number().nonnegative().nullable(),
  retentionRate: z.number().nonnegative().nullable(), engagementRate: z.number().nonnegative().nullable(),
}).strict();
export type AnalyticsMetrics = z.infer<typeof analyticsMetricsSchema>;
export const analyticsProviderSchema = z.enum(['mock', 'manual', 'youtube', 'facebook', 'tiktok']);
export type AnalyticsProvider = z.infer<typeof analyticsProviderSchema>;
const platformSchema = z.enum(['YOUTUBE', 'FACEBOOK', 'TIKTOK']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'Use a valid calendar date');
const inputSchema = z.object({
  publicationId: z.string().min(1).max(200), platform: platformSchema, remoteId: z.string().regex(/^[\w:-]{1,200}$/),
  accountExternalId: z.string().regex(/^[\w:-]{1,200}$/), publishedAt: z.string().datetime({ offset: true }).optional(),
  videoDurationSeconds: z.number().positive().optional(), startDate: dateSchema.optional(), endDate: dateSchema.optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((input, context) => {
  if (input.startDate && input.endDate && input.startDate > input.endDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must follow start date.' });
});
export type AnalyticsInput = z.infer<typeof inputSchema>;
const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const analyticsSnapshotSchema = z.object({
  version: z.literal(1), provider: analyticsProviderSchema, platform: platformSchema,
  publicationId: z.string().min(1), remoteId: z.string().min(1), accountExternalId: z.string().min(1),
  observedAt: z.string().datetime({ offset: true }), publishedAt: z.string().datetime({ offset: true }).nullable(),
  videoDurationSeconds: z.number().positive().nullable(), scope: z.enum(['LIFETIME', 'PERIOD']),
  period: z.object({ startDate: dateSchema, endDate: dateSchema }).strict().nullable(),
  metrics: analyticsMetricsSchema, availability: z.record(z.enum(metricNames), z.enum(['AVAILABLE', 'UNAVAILABLE'])),
  definitions: z.record(z.string(), z.string()), raw: z.record(z.string(), scalarSchema), synthetic: z.boolean(),
}).strict().superRefine((snapshot, context) => {
  for (const name of metricNames) if ((snapshot.metrics[name] === null) !== (snapshot.availability[name] === 'UNAVAILABLE')) context.addIssue({ code: 'custom', path: ['availability', name], message: 'Metric availability must match its nullable value.' });
  if ((snapshot.scope === 'PERIOD') !== (snapshot.period !== null)) context.addIssue({ code: 'custom', path: ['period'], message: 'Period metrics require explicit dates; lifetime metrics must not claim a period.' });
  if ((snapshot.provider === 'mock') !== snapshot.synthetic) context.addIssue({ code: 'custom', path: ['synthetic'], message: 'Mock provenance must remain explicitly synthetic.' });
});
export type AnalyticsSnapshot = z.infer<typeof analyticsSnapshotSchema>;
export interface AnalyticsCapabilities { supported: boolean; supportedMetrics: MetricName[]; status: 'READY' | 'BLOCKED_EXTERNAL'; reason: string | null }
export interface AnalyticsAdapter {
  readonly provider: AnalyticsProvider;
  capabilities(): AnalyticsCapabilities;
  fetchMetrics(input: AnalyticsInput): Promise<AnalyticsSnapshot>;
}
export interface FacebookMetric { name: string; unit: 'COUNT' | 'SECONDS' | 'MILLISECONDS' | 'PERCENT' | 'RATIO'; definition: string }
export interface AnalyticsAdapterOptions {
  accessToken?: string; grantedScopes?: string[]; approved?: boolean; liveEnabled?: boolean; apiVersion?: string;
  facebookMetrics?: Partial<Record<MetricName, FacebookMetric>>;
  fetcher?: typeof fetch; manualMetrics?: Partial<AnalyticsMetrics>; manualDefinitions?: Partial<Record<MetricName, string>>;
}
export class AnalyticsError extends Error {
  constructor(readonly code: 'BLOCKED_EXTERNAL' | 'TOKEN_EXPIRED' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_RESPONSE_INVALID' | 'METRICS_UNAVAILABLE', readonly retryable = false, readonly retryAfterSeconds: number | null = null) { super(code); }
}

const emptyMetrics = (): AnalyticsMetrics => ({ views: null, likes: null, comments: null, shares: null, watchTimeSeconds: null, averageViewDurationSeconds: null, retentionRate: null, engagementRate: null });
function makeSnapshot(input: AnalyticsInput, provider: AnalyticsProvider, supplied: Partial<AnalyticsMetrics>, definitions: Record<string, string>, raw: Record<string, string | number | boolean | null>, period: AnalyticsSnapshot['period'] = null): AnalyticsSnapshot {
  const metrics = analyticsMetricsSchema.parse({ ...emptyMetrics(), ...supplied });
  if (metrics.views !== null && metrics.views > 0 && metrics.likes !== null && metrics.comments !== null && metrics.shares !== null) {
    metrics.engagementRate = (metrics.likes + metrics.comments + metrics.shares) / metrics.views;
    definitions.engagementRate = '(likes + comments + shares) / views within the same provider scope and period; not a unique-user rate.';
  }
  return analyticsSnapshotSchema.parse({ version: 1, provider, platform: input.platform, publicationId: input.publicationId,
    remoteId: input.remoteId, accountExternalId: input.accountExternalId, observedAt: input.observedAt ?? new Date().toISOString(),
    publishedAt: input.publishedAt ?? null, videoDurationSeconds: input.videoDurationSeconds ?? null,
    scope: period ? 'PERIOD' : 'LIFETIME', period, metrics,
    availability: Object.fromEntries(metricNames.map((name) => [name, metrics[name] === null ? 'UNAVAILABLE' : 'AVAILABLE'])),
    definitions, raw, synthetic: provider === 'mock',
  });
}
function value(raw: unknown): number | null { return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null; }
function dateRange(input: AnalyticsInput) {
  const endDate = input.endDate ?? (input.observedAt ?? new Date().toISOString()).slice(0, 10);
  const startDate = input.startDate ?? input.publishedAt?.slice(0, 10);
  if (!startDate || startDate > endDate) throw new AnalyticsError('METRICS_UNAVAILABLE');
  return { startDate, endDate };
}
async function requestJson(fetcher: typeof fetch, url: URL, accessToken: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }); }
  catch { throw new AnalyticsError('PROVIDER_UNAVAILABLE', true); }
  if (!response.ok) {
    if (response.status === 401) throw new AnalyticsError('TOKEN_EXPIRED');
    if (response.status === 403) throw new AnalyticsError('BLOCKED_EXTERNAL');
    if (response.status === 429) { const delay = Number(response.headers.get('retry-after')); throw new AnalyticsError('RATE_LIMITED', true, Number.isFinite(delay) && delay > 0 ? delay : null); }
    throw new AnalyticsError('PROVIDER_UNAVAILABLE', response.status >= 500);
  }
  try { return await response.json(); } catch { throw new AnalyticsError('PROVIDER_RESPONSE_INVALID'); }
}

export class ManualAnalyticsAdapter implements AnalyticsAdapter {
  readonly provider = 'manual' as const;
  constructor(private readonly options: AnalyticsAdapterOptions = {}) {}
  capabilities(): AnalyticsCapabilities { return { supported: true, supportedMetrics: [...metricNames], status: 'READY', reason: null }; }
  async fetchMetrics(raw: AnalyticsInput): Promise<AnalyticsSnapshot> {
    const input = inputSchema.parse(raw);
    const metrics = analyticsMetricsSchema.partial().parse(this.options.manualMetrics ?? {});
    if (!Object.values(metrics).some((metric) => metric !== null && metric !== undefined)) throw new AnalyticsError('METRICS_UNAVAILABLE');
    const definitions = Object.fromEntries(metricNames.map((name) => [name, this.options.manualDefinitions?.[name] ?? `Manually supplied ${name}; provider definition must be confirmed before comparing.`]));
    const period = input.startDate || input.endDate ? dateRange(input) : null;
    return makeSnapshot(input, this.provider, metrics, definitions, Object.fromEntries(Object.entries(metrics)), period);
  }
}
export class MockAnalyticsAdapter implements AnalyticsAdapter {
  readonly provider = 'mock' as const;
  constructor() { if (process.env.NODE_ENV === 'production') throw new AnalyticsError('BLOCKED_EXTERNAL'); }
  capabilities(): AnalyticsCapabilities { return { supported: true, supportedMetrics: [...metricNames], status: 'READY', reason: 'SYNTHETIC_TEST_DATA' }; }
  async fetchMetrics(raw: AnalyticsInput): Promise<AnalyticsSnapshot> {
    if (process.env.NODE_ENV === 'production') throw new AnalyticsError('BLOCKED_EXTERNAL');
    const input = inputSchema.parse(raw);
    const seed = createHash('sha256').update(input.publicationId).digest().readUInt32BE(0);
    const views = 100 + seed % 2000;
    return makeSnapshot(input, this.provider, { views, likes: Math.floor(views * 0.08), comments: Math.floor(views * 0.01), shares: Math.floor(views * 0.02), watchTimeSeconds: views * 18, averageViewDurationSeconds: 18, retentionRate: null }, Object.fromEntries(metricNames.map((name) => [name, `Deterministic synthetic ${name}; excluded from real performance comparisons.`])), { seed, views });
  }
}

abstract class LiveAnalyticsAdapter implements AnalyticsAdapter {
  abstract readonly provider: AnalyticsProvider;
  abstract readonly platform: AnalyticsInput['platform'];
  abstract readonly requiredScopes: string[];
  abstract readonly supportedMetrics: MetricName[];
  constructor(protected readonly options: AnalyticsAdapterOptions = {}) {}
  capabilities(): AnalyticsCapabilities {
    const supported = this.options.liveEnabled === true && this.options.approved === true && Boolean(this.options.accessToken) && this.requiredScopes.every((scope) => this.options.grantedScopes?.includes(scope));
    return { supported, supportedMetrics: supported ? this.supportedMetrics : [], status: supported ? 'READY' : 'BLOCKED_EXTERNAL', reason: supported ? null : 'Authorized analytics product, token and required scopes must be verified.' };
  }
  protected validate(raw: AnalyticsInput): AnalyticsInput {
    if (!this.capabilities().supported) throw new AnalyticsError('BLOCKED_EXTERNAL');
    const input = inputSchema.parse(raw);
    if (input.platform !== this.platform) throw new AnalyticsError('BLOCKED_EXTERNAL');
    return input;
  }
  protected json(url: URL, init?: RequestInit) { return requestJson(this.options.fetcher ?? fetch, url, this.options.accessToken ?? '', init); }
  abstract fetchMetrics(input: AnalyticsInput): Promise<AnalyticsSnapshot>;
}

export class YouTubeAnalyticsAdapter extends LiveAnalyticsAdapter {
  readonly provider = 'youtube' as const;
  readonly platform = 'YOUTUBE' as const;
  readonly requiredScopes = ['https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.readonly'];
  readonly supportedMetrics: MetricName[] = ['views', 'likes', 'comments', 'shares', 'watchTimeSeconds', 'averageViewDurationSeconds', 'retentionRate', 'engagementRate'];
  async fetchMetrics(raw: AnalyticsInput): Promise<AnalyticsSnapshot> {
    const input = this.validate(raw);
    const period = dateRange(input);
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    const columns = ['views', 'likes', 'comments', 'shares', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage'];
    url.search = new URLSearchParams({ ids: `channel==${input.accountExternalId}`, filters: `video==${input.remoteId}`, startDate: period.startDate, endDate: period.endDate, metrics: columns.join(',') }).toString();
    const parsed = z.object({ columnHeaders: z.array(z.object({ name: z.string() })), rows: z.array(z.array(z.union([z.number(), z.string(), z.null()]))).optional() }).safeParse(await this.json(url));
    if (!parsed.success) throw new AnalyticsError('PROVIDER_RESPONSE_INVALID');
    const row = parsed.data.rows?.[0];
    if (!row) return makeSnapshot(input, this.provider, {}, { views: 'YouTube Analytics views in the requested reporting period; processing delays may leave metrics unavailable.' }, {}, period);
    if ((parsed.data.rows?.length ?? 0) > 1) throw new AnalyticsError('PROVIDER_RESPONSE_INVALID');
    const numbers = Object.fromEntries(parsed.data.columnHeaders.map((header, index) => [header.name, value(row[index])]));
    const minutes = numbers.estimatedMinutesWatched ?? null;
    const percentage = numbers.averageViewPercentage ?? null;
    return makeSnapshot(input, this.provider, { views: numbers.views ?? null, likes: numbers.likes ?? null, comments: numbers.comments ?? null, shares: numbers.shares ?? null, watchTimeSeconds: minutes === null ? null : minutes * 60, averageViewDurationSeconds: numbers.averageViewDuration ?? null, retentionRate: percentage === null ? null : percentage / 100 }, {
      views: 'YouTube Analytics views in the requested reporting period; provider view definitions may differ by content type.',
      likes: 'YouTube Analytics likes during the reporting period.', comments: 'YouTube Analytics comments during the reporting period.', shares: 'YouTube Analytics share-button uses during the reporting period.',
      watchTimeSeconds: 'YouTube estimatedMinutesWatched multiplied by 60.', averageViewDurationSeconds: 'YouTube averageViewDuration in seconds; excludes looping clip traffic.', retentionRate: 'YouTube averageViewPercentage divided by 100; may exceed 1 for repeated viewing and is not a retention curve.',
    }, numbers, period);
  }
}

export class TikTokAnalyticsAdapter extends LiveAnalyticsAdapter {
  readonly provider = 'tiktok' as const;
  readonly platform = 'TIKTOK' as const;
  readonly requiredScopes = ['video.list'];
  readonly supportedMetrics: MetricName[] = ['views', 'likes', 'comments', 'shares', 'engagementRate'];
  async fetchMetrics(raw: AnalyticsInput): Promise<AnalyticsSnapshot> {
    const input = this.validate(raw);
    if (input.startDate || input.endDate) throw new AnalyticsError('METRICS_UNAVAILABLE');
    const url = new URL('https://open.tiktokapis.com/v2/video/query/');
    url.searchParams.set('fields', 'id,view_count,like_count,comment_count,share_count');
    const number = z.number().int().nonnegative().optional();
    const parsed = z.object({ data: z.object({ videos: z.array(z.object({ id: z.string(), view_count: number, like_count: number, comment_count: number, share_count: number })) }).optional(), error: z.object({ code: z.string() }) }).safeParse(await this.json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { video_ids: [input.remoteId] } }) }));
    if (!parsed.success) throw new AnalyticsError('PROVIDER_RESPONSE_INVALID');
    if (parsed.data.error.code !== 'ok') throw new AnalyticsError(parsed.data.error.code === 'access_token_invalid' ? 'TOKEN_EXPIRED' : 'BLOCKED_EXTERNAL');
    const video = parsed.data.data?.videos.find((item) => item.id === input.remoteId);
    if (!video) throw new AnalyticsError('METRICS_UNAVAILABLE');
    return makeSnapshot(input, this.provider, { views: video.view_count ?? null, likes: video.like_count ?? null, comments: video.comment_count ?? null, shares: video.share_count ?? null }, {
      views: 'TikTok Display API authorized-video lifetime view_count.', likes: 'TikTok Display API authorized-video lifetime like_count.', comments: 'TikTok Display API authorized-video lifetime comment_count.', shares: 'TikTok Display API authorized-video lifetime share_count.',
    }, { view_count: video.view_count ?? null, like_count: video.like_count ?? null, comment_count: video.comment_count ?? null, share_count: video.share_count ?? null });
  }
}

export class FacebookInsightsAdapter extends LiveAnalyticsAdapter {
  readonly provider = 'facebook' as const;
  readonly platform = 'FACEBOOK' as const;
  readonly requiredScopes = ['read_insights', 'pages_read_engagement'];
  readonly supportedMetrics: MetricName[] = ['views', 'likes', 'comments', 'shares', 'watchTimeSeconds', 'averageViewDurationSeconds', 'retentionRate'];
  override capabilities(): AnalyticsCapabilities {
    const capability = super.capabilities();
    const configured = /^v\d+\.\d+$/.test(this.options.apiVersion ?? '') && Object.keys(this.options.facebookMetrics ?? {}).length > 0;
    if (!configured) return { supported: false, supportedMetrics: [], status: 'BLOCKED_EXTERNAL', reason: 'Verify the Graph API version and available Page/Reel metric names and units before enabling analytics.' };
    return capability;
  }
  async fetchMetrics(raw: AnalyticsInput): Promise<AnalyticsSnapshot> {
    const input = this.validate(raw);
    if (input.startDate || input.endDate) throw new AnalyticsError('METRICS_UNAVAILABLE');
    const mappingSchema = z.partialRecord(z.enum(metricNames), z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{1,99}$/), unit: z.enum(['COUNT', 'SECONDS', 'MILLISECONDS', 'PERCENT', 'RATIO']), definition: z.string().min(1).max(1000) }).strict());
    const mappings = mappingSchema.safeParse(this.options.facebookMetrics);
    if (!mappings.success) throw new AnalyticsError('BLOCKED_EXTERNAL');
    const url = new URL(`https://graph.facebook.com/${this.options.apiVersion}/${encodeURIComponent(input.remoteId)}/video_insights`);
    url.searchParams.set('metric', Object.values(mappings.data).map((metric) => metric.name).join(','));
    url.searchParams.set('period', 'lifetime');
    const parsed = z.object({ data: z.array(z.object({ name: z.string(), period: z.string().optional(), values: z.array(z.object({ value: z.unknown() })) })) }).safeParse(await this.json(url));
    if (!parsed.success) throw new AnalyticsError('PROVIDER_RESPONSE_INVALID');
    const metrics: Partial<AnalyticsMetrics> = {};
    const definitions: Record<string, string> = {};
    const providerValues: Record<string, number | null> = {};
    for (const [key, mapping] of Object.entries(mappings.data)) {
      const series = parsed.data.data.find((metric) => metric.name === mapping.name && (!metric.period || metric.period === 'lifetime'));
      const current = series?.values.length === 1 ? value(series.values[0]?.value) : null;
      providerValues[mapping.name] = current;
      metrics[key as MetricName] = current === null ? null : mapping.unit === 'MILLISECONDS' ? current / 1000 : mapping.unit === 'PERCENT' ? current / 100 : current;
      definitions[key] = mapping.definition;
    }
    return makeSnapshot(input, this.provider, metrics, definitions, providerValues);
  }
}

export function createAnalyticsAdapter(provider: AnalyticsProvider, options: AnalyticsAdapterOptions = {}): AnalyticsAdapter {
  switch (analyticsProviderSchema.parse(provider)) {
    case 'mock': return new MockAnalyticsAdapter();
    case 'manual': return new ManualAnalyticsAdapter(options);
    case 'youtube': return new YouTubeAnalyticsAdapter(options);
    case 'facebook': return new FacebookInsightsAdapter(options);
    case 'tiktok': return new TikTokAnalyticsAdapter(options);
  }
}

export function snapshotFreshness(snapshot: Pick<AnalyticsSnapshot, 'observedAt'>, now = new Date(), maximumAgeMs = 86_400_000): 'FRESH' | 'STALE' | 'INVALID' {
  const age = now.getTime() - Date.parse(snapshot.observedAt);
  return !Number.isFinite(age) || age < -300_000 ? 'INVALID' : age > maximumAgeMs ? 'STALE' : 'FRESH';
}

export interface PerformanceObservation { snapshotId: string; publicationId: string; snapshot: AnalyticsSnapshot; dimensions: Record<string, string> }
export interface PerformanceSummary { comparisonKey: string; sampleSize: number; availableViews: number; totalViews: number | null; meanViews: number | null; meanEngagementRate: number | null; evidenceIds: string[]; synthetic: boolean }
function comparisonKey(snapshot: AnalyticsSnapshot) { return JSON.stringify([snapshot.platform, snapshot.provider, snapshot.scope, snapshot.period, snapshot.synthetic, metricNames.map((name) => snapshot.definitions[name] ?? null)]); }
function latestObservations(observations: PerformanceObservation[]): PerformanceObservation[] {
  const latest = new Map<string, PerformanceObservation>();
  for (const observation of observations) {
    const key = JSON.stringify([observation.publicationId, comparisonKey(observation.snapshot)]);
    const previous = latest.get(key);
    if (!previous || Date.parse(observation.snapshot.observedAt) > Date.parse(previous.snapshot.observedAt)) latest.set(key, observation);
  }
  return [...latest.values()].sort((a, b) => a.publicationId.localeCompare(b.publicationId));
}
export function summarizePerformance(observations: PerformanceObservation[]): PerformanceSummary[] {
  const groups = new Map<string, PerformanceObservation[]>();
  for (const item of latestObservations(observations)) { const key = comparisonKey(item.snapshot); groups.set(key, [...groups.get(key) ?? [], item]); }
  return [...groups.entries()].map(([key, items]) => {
    const views = items.flatMap((item) => item.snapshot.metrics.views === null ? [] : [item.snapshot.metrics.views]);
    const engagements = items.flatMap((item) => item.snapshot.metrics.engagementRate === null ? [] : [item.snapshot.metrics.engagementRate]);
    return { comparisonKey: key, sampleSize: items.length, availableViews: views.length, totalViews: views.length ? views.reduce((sum, count) => sum + count, 0) : null,
      meanViews: views.length ? views.reduce((sum, count) => sum + count, 0) / views.length : null,
      meanEngagementRate: engagements.length ? engagements.reduce((sum, rate) => sum + rate, 0) / engagements.length : null,
      evidenceIds: items.map((item) => item.snapshotId), synthetic: items[0]?.snapshot.synthetic ?? false };
  });
}
export interface PerformanceRecommendation { algorithmVersion: 'descriptive-v1'; dimension: string; value: string; comparisonKey: string; sampleSize: number; baselineSampleSize: number; meanViews: number; baselineMeanViews: number; evidenceIds: string[]; title: string; explanation: string; kind: 'OBSERVATION'; synthetic: boolean }
export function recommendPerformance(observations: PerformanceObservation[], minimumSamples = 5): PerformanceRecommendation[] {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 3) throw new Error('RECOMMENDATION_SAMPLE_MINIMUM_INVALID');
  const latest = latestObservations(observations).filter((item) => item.snapshot.metrics.views !== null);
  const recommendations: PerformanceRecommendation[] = [];
  for (const summary of summarizePerformance(latest)) {
    const cohort = latest.filter((item) => comparisonKey(item.snapshot) === summary.comparisonKey);
    const dimensions = [...new Set(cohort.flatMap((item) => Object.keys(item.dimensions)))].sort();
    for (const dimension of dimensions) {
      const labels = [...new Set(cohort.map((item) => item.dimensions[dimension]).filter((label): label is string => Boolean(label)))].sort();
      for (const label of labels) {
        const group = cohort.filter((item) => item.dimensions[dimension] === label);
        const baseline = cohort.filter((item) => item.dimensions[dimension] !== undefined && item.dimensions[dimension] !== label);
        if (group.length < minimumSamples || baseline.length < minimumSamples) continue;
        const mean = group.reduce((sum, item) => sum + (item.snapshot.metrics.views ?? 0), 0) / group.length;
        const baselineMean = baseline.reduce((sum, item) => sum + (item.snapshot.metrics.views ?? 0), 0) / baseline.length;
        if (mean <= baselineMean) continue;
        recommendations.push({ algorithmVersion: 'descriptive-v1', dimension, value: label, comparisonKey: summary.comparisonKey, sampleSize: group.length, baselineSampleSize: baseline.length, meanViews: mean, baselineMeanViews: baselineMean,
          evidenceIds: [...group, ...baseline].map((item) => item.snapshotId), title: `Review ${dimension}: ${label}`,
          explanation: `${group.length} publications with this ${dimension} averaged ${Math.round(mean)} views versus ${Math.round(baselineMean)} across ${baseline.length} other publications in the same metric scope. This is an observed association; content age, audience and other differences can explain it. Test on separate eligible content before changing rules.`, kind: 'OBSERVATION', synthetic: summary.synthetic });
      }
    }
  }
  return recommendations;
}

export interface ExperimentOutcome { contentId: string; variantId: string; views: number | null }
export interface ExperimentSummary { status: 'INSUFFICIENT_DATA' | 'INCONCLUSIVE' | 'OBSERVED_DIFFERENCE'; variants: Array<{ variantId: string; sampleSize: number; meanViews: number | null; standardError: number | null; interval95: [number, number] | null }>; leadingVariantId: string | null; explanation: string }
export function experimentResults(outcomes: ExperimentOutcome[], variantIds: string[], minimumSamples = 10): ExperimentSummary {
  if (variantIds.length < 2 || new Set(variantIds).size !== variantIds.length || minimumSamples < 3 || !Number.isInteger(minimumSamples)) throw new Error('EXPERIMENT_CONFIGURATION_INVALID');
  const assigned = new Set<string>();
  for (const outcome of outcomes) {
    if (assigned.has(outcome.contentId) || !variantIds.includes(outcome.variantId) || (outcome.views !== null && (!Number.isFinite(outcome.views) || outcome.views < 0))) throw new Error('EXPERIMENT_OUTCOME_INVALID');
    assigned.add(outcome.contentId);
  }
  const variants = variantIds.map((variantId) => {
    const values = outcomes.filter((outcome) => outcome.variantId === variantId).flatMap((outcome) => outcome.views === null ? [] : [outcome.views]);
    const mean = values.length ? values.reduce((sum, count) => sum + count, 0) / values.length : null;
    const variance = values.length > 1 && mean !== null ? values.reduce((sum, count) => sum + (count - mean) ** 2, 0) / (values.length - 1) : null;
    const error = variance === null ? null : Math.sqrt(variance / values.length);
    return { variantId, sampleSize: values.length, meanViews: mean, standardError: error, interval95: mean === null || error === null ? null : [Math.max(0, mean - 1.96 * error), mean + 1.96 * error] as [number, number] };
  });
  if (variants.some((variant) => variant.sampleSize < minimumSamples)) return { status: 'INSUFFICIENT_DATA', variants, leadingVariantId: null, explanation: `At least ${minimumSamples} distinct eligible content items with available outcomes per variant are required. No winner is declared.` };
  const ordered = [...variants].sort((a, b) => (b.meanViews ?? 0) - (a.meanViews ?? 0));
  const leader = ordered[0];
  const separated = leader?.interval95 && ordered.slice(1).every((variant) => variant.interval95 && (leader.interval95?.[0] ?? 0) > variant.interval95[1]);
  return { status: separated ? 'OBSERVED_DIFFERENCE' : 'INCONCLUSIVE', variants, leadingVariantId: separated ? leader.variantId : null,
    explanation: 'Approximate normal 95% intervals describe observed mean views. They assume independent samples, do not adjust for multiple comparisons, and do not establish causality or automatically select a winner.' };
}
