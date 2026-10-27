import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsError, FacebookInsightsAdapter, ManualAnalyticsAdapter, MockAnalyticsAdapter, TikTokAnalyticsAdapter, YouTubeAnalyticsAdapter, analyticsSnapshotSchema, experimentResults, recommendPerformance, snapshotFreshness, summarizePerformance, type AnalyticsInput, type AnalyticsSnapshot, type PerformanceObservation } from './index';

const input: AnalyticsInput = { publicationId: 'publication-a', platform: 'YOUTUBE', remoteId: 'video-a', accountExternalId: 'channel-a', publishedAt: '2026-10-01T09:00:00Z', observedAt: '2026-10-27T12:00:00Z', videoDurationSeconds: 40 };
const youtubeScopes = ['https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.readonly'];
afterEach(() => vi.unstubAllEnvs());

describe('analytics adapters', () => {
  it('preserves unavailable metrics as null, including an unavailable denominator', async () => {
    const adapter = new ManualAnalyticsAdapter({ manualMetrics: { views: 0, likes: 0 } });
    const result = await adapter.fetchMetrics(input);
    expect(result.metrics).toMatchObject({ views: 0, likes: 0, comments: null, shares: null, engagementRate: null });
    expect(result.availability.comments).toBe('UNAVAILABLE');
    expect(result.availability.views).toBe('AVAILABLE');
    expect(result.synthetic).toBe(false);
    expect(result.raw).toEqual({ views: 0, likes: 0 });
    await expect(new ManualAnalyticsAdapter({ manualMetrics: { views: -1 } }).fetchMetrics(input)).rejects.toThrow();
    await expect(new ManualAnalyticsAdapter({ manualMetrics: { views: 1 } }).fetchMetrics({ ...input, startDate: '2026-02-31' })).rejects.toThrow();
    expect(analyticsSnapshotSchema.safeParse({ ...result, availability: { ...result.availability, shares: 'AVAILABLE' } }).success).toBe(false);
  });

  it('produces repeatable labeled fixtures and rejects mocks in production', async () => {
    const adapter = new MockAnalyticsAdapter();
    expect(await adapter.fetchMetrics(input)).toEqual(await adapter.fetchMetrics(input));
    expect((await adapter.fetchMetrics(input)).synthetic).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new MockAnalyticsAdapter()).toThrow('BLOCKED_EXTERNAL');
    await expect(adapter.fetchMetrics(input)).rejects.toThrow('BLOCKED_EXTERNAL');
  });

  it('requires verified authorization and both YouTube scopes before calling the official endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewPercentage' }], rows: [[15, 2, 135]] })));
    const unauthorized = new YouTubeAnalyticsAdapter({ accessToken: 'private-token', grantedScopes: youtubeScopes.slice(0, 1), approved: true, liveEnabled: true, fetcher });
    expect(unauthorized.capabilities().status).toBe('BLOCKED_EXTERNAL');
    await expect(unauthorized.fetchMetrics(input)).rejects.toThrow('BLOCKED_EXTERNAL');
    expect(fetcher).not.toHaveBeenCalled();
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: 'private-token', grantedScopes: youtubeScopes, approved: true, liveEnabled: true, fetcher });
    const result = await adapter.fetchMetrics(input);
    expect(result.metrics).toMatchObject({ views: 15, watchTimeSeconds: 120, retentionRate: 1.35, likes: null });
    expect(result.period).toEqual({ startDate: '2026-10-01', endDate: '2026-10-27' });
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toContain('https://youtubeanalytics.googleapis.com/v2/reports?');
    expect(String(url)).not.toContain('private-token');
    expect(options).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer private-token' } });
  });

  it('does not change an empty YouTube report into zero views and sanitizes provider failures', async () => {
    const options = { accessToken: 'secret-never-log', grantedScopes: youtubeScopes, approved: true, liveEnabled: true };
    const result = await new YouTubeAnalyticsAdapter({ ...options, fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ columnHeaders: [{ name: 'views' }], rows: [] }))) }).fetchMetrics(input);
    expect(result.metrics.views).toBeNull();
    const adapter = new YouTubeAnalyticsAdapter({ ...options, fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-never-log', { status: 429, headers: { 'retry-after': '30' } })) });
    await expect(adapter.fetchMetrics(input)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true, retryAfterSeconds: 30, message: 'RATE_LIMITED' });
  });

  it('uses TikTok owner-scoped video query and reports only supported lifetime metrics', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'ok' }, data: { videos: [{ id: 'video-a', view_count: 100, like_count: 5, comment_count: 2, share_count: 3 }] } })));
    const adapter = new TikTokAnalyticsAdapter({ accessToken: 'secret', grantedScopes: ['video.list'], approved: true, liveEnabled: true, fetcher });
    const result = await adapter.fetchMetrics({ ...input, platform: 'TIKTOK' });
    expect(result.scope).toBe('LIFETIME');
    expect(result.metrics).toMatchObject({ views: 100, engagementRate: 0.1, watchTimeSeconds: null, retentionRate: null });
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toContain('https://open.tiktokapis.com/v2/video/query/');
    expect(options?.body).toBe(JSON.stringify({ filters: { video_ids: ['video-a'] } }));
    await expect(adapter.fetchMetrics({ ...input, platform: 'TIKTOK', startDate: '2026-10-01', endDate: '2026-10-27' })).rejects.toThrow('METRICS_UNAVAILABLE');
  });

  it('requires verified Facebook version/metric definitions and keeps missing metric data unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ name: 'verified_watch_time', period: 'lifetime', values: [{ value: 2500 }] }] })));
    const options = { accessToken: 'secret', grantedScopes: ['read_insights', 'pages_read_engagement'], approved: true, liveEnabled: true, fetcher };
    expect(new FacebookInsightsAdapter(options).capabilities().supported).toBe(false);
    const adapter = new FacebookInsightsAdapter({ ...options, apiVersion: 'v26.0', facebookMetrics: { watchTimeSeconds: { name: 'verified_watch_time', unit: 'MILLISECONDS', definition: 'Verified metric in configured API version.' }, views: { name: 'verified_views', unit: 'COUNT', definition: 'Verified provider view definition.' } } });
    const result = await adapter.fetchMetrics({ ...input, platform: 'FACEBOOK' });
    expect(result.metrics.watchTimeSeconds).toBe(2.5);
    expect(result.metrics.views).toBeNull();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://graph.facebook.com/v26.0/video-a/video_insights?');
  });

  it('marks data stale without treating future timestamps as fresh evidence', () => {
    expect(snapshotFreshness({ observedAt: '2026-10-25T10:00:00Z' }, new Date('2026-10-27T10:00:00Z'))).toBe('STALE');
    expect(snapshotFreshness({ observedAt: '2026-10-27T09:00:00Z' }, new Date('2026-10-27T10:00:00Z'))).toBe('FRESH');
    expect(snapshotFreshness({ observedAt: '2026-10-28T09:00:00Z' }, new Date('2026-10-27T10:00:00Z'))).toBe('INVALID');
    expect(new AnalyticsError('BLOCKED_EXTERNAL').message).toBe('BLOCKED_EXTERNAL');
  });
});

describe('performance observations and experiments', () => {
  async function observations(): Promise<PerformanceObservation[]> {
    const snapshot = await new ManualAnalyticsAdapter({ manualMetrics: { views: 10 } }).fetchMetrics(input);
    return Array.from({ length: 10 }, (_, index) => ({ snapshotId: `snapshot-${index}`, publicationId: `publication-${index}`, snapshot: { ...snapshot, publicationId: `publication-${index}`, metrics: { ...snapshot.metrics, views: index < 5 ? 100 : 10 } } as AnalyticsSnapshot, dimensions: { template: index < 5 ? 'A' : 'B' } }));
  }

  it('deduplicates repeated snapshots and requires independently observed samples', async () => {
    const data = await observations();
    const first = data[0];
    if (!first) throw new Error('fixture missing');
    const repeated = { ...first, snapshotId: 'latest', snapshot: { ...first.snapshot, observedAt: '2026-10-27T13:00:00Z' } };
    const summary = summarizePerformance([...data, repeated]);
    expect(summary[0]?.sampleSize).toBe(10);
    expect(summary[0]?.evidenceIds).toContain('latest');
    const recommendations = recommendPerformance([...data, repeated]);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ dimension: 'template', value: 'A', sampleSize: 5, baselineSampleSize: 5, kind: 'OBSERVATION', meanViews: 100, baselineMeanViews: 10 });
    expect(recommendations[0]?.explanation).toContain('observed association');
    expect(recommendPerformance(data.slice(0, 7))).toHaveLength(0);
  });

  it('separates incompatible metric definitions and synthetic/live cohorts', async () => {
    const data = await observations();
    const first = data[0];
    if (!first) throw new Error('fixture missing');
    const different = { ...first, publicationId: 'different', snapshot: { ...first.snapshot, platform: 'FACEBOOK' as const } };
    const synthetic = { ...first, publicationId: 'synthetic', snapshot: { ...first.snapshot, provider: 'mock' as const, synthetic: true } };
    expect(summarizePerformance([...data, different, synthetic])).toHaveLength(3);
  });

  it('keeps tiny or overlapping experiment samples inconclusive and rejects duplicate content assignments', () => {
    expect(experimentResults([{ contentId: 'one', variantId: 'A', views: 100 }], ['A', 'B']).status).toBe('INSUFFICIENT_DATA');
    const values = Array.from({ length: 20 }, (_, index) => ({ contentId: `content-${index}`, variantId: index < 10 ? 'A' : 'B', views: 100 + index % 10 }));
    expect(experimentResults(values, ['A', 'B']).status).toBe('INCONCLUSIVE');
    expect(() => experimentResults([...values, { contentId: 'content-0', variantId: 'B', views: 10 }], ['A', 'B'])).toThrow('EXPERIMENT_OUTCOME_INVALID');
  });
});
