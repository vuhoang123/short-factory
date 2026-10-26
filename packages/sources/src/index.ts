import type { DiscoveryQuery, NormalizedComment, NormalizedPost, SourceAccessStatus, SourceAdapter, SourceCapability, SourcePlatform } from '@shorts-factory/shared';
import { z } from 'zod';

export { detectSensitiveFlags, scoreContent, scoreWeights } from './scoring.js';
export type { ContentScore, ScoreFactors } from './scoring.js';

const querySchema = z.object({
  keywords: z.array(z.string().trim().max(80)).max(100).default([]),
  hashtags: z.array(z.string().trim().max(80)).max(100).default([]),
  topics: z.array(z.string().trim().max(80)).max(100).default([]),
  language: z.string().trim().max(20).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(100),
}).strict();

const demoPosts: readonly NormalizedPost[] = [
  {
    platform: 'MANUAL', externalId: 'demo-community-library-001', canonicalUrl: 'https://example.org/demo/community-library',
    title: 'A neighborhood library finds a new home',
    text: 'What happens when a quiet neighborhood library has to move? Volunteers turn an unused corner of a shared space into a free book exchange, and neighbors keep it open together.',
    language: 'en', topicTags: ['community', 'books', 'volunteering'], synthetic: true, fetchedAt: '2026-01-01T00:00:00.000Z', publishedAt: '2025-12-28T00:00:00.000Z',
    metrics: { likes: 128, comments: 34, shares: 21, views: 1600 },
    rawPayload: { fixture: 'synthetic-demo-v1', externalId: 'demo-community-library-001' },
  },
  {
    platform: 'MANUAL', externalId: 'demo-night-market-002', canonicalUrl: 'https://example.org/demo/night-market',
    title: 'The night market that became a meeting place',
    text: 'How did a row of food stalls become the place where the whole block meets? A family-run night market started with one table and grew through recipes, shared cleanup, and a weekly music night.',
    language: 'en', topicTags: ['community', 'food', 'culture'], synthetic: true, fetchedAt: '2026-01-01T00:00:00.000Z', publishedAt: '2025-12-31T00:00:00.000Z',
    metrics: { likes: 84, comments: 18, shares: 12, views: 980 },
    rawPayload: { fixture: 'synthetic-demo-v1', externalId: 'demo-night-market-002' },
  },
  {
    platform: 'MANUAL', externalId: 'demo-repair-club-003', canonicalUrl: 'https://example.org/demo/repair-club',
    title: 'A repair club gives old bikes another ride',
    text: 'Could a small repair club keep dozens of bikes out of storage? A volunteer group shares basic tools and simple lessons so students can fix a flat tire and get back on the road.',
    language: 'en', topicTags: ['community', 'bikes', 'volunteering'], synthetic: true, fetchedAt: '2026-01-01T00:00:00.000Z', publishedAt: '2025-12-30T00:00:00.000Z',
    metrics: { likes: 57, comments: 11, shares: 16, views: 710 },
    rawPayload: { fixture: 'synthetic-demo-v1', externalId: 'demo-repair-club-003' },
  },
];

const demoComments: Readonly<Record<string, readonly NormalizedComment[]>> = {
  'demo-community-library-001': [
    { externalId: 'demo-library-c1', text: 'I would love to help organize a shelf like this.' },
    { externalId: 'demo-library-c2', text: 'The volunteers made a welcoming place for everyone.' },
    { externalId: 'demo-library-c3', text: 'A simple book exchange can bring people together.' },
  ],
  'demo-night-market-002': [
    { externalId: 'demo-market-c1', text: 'The shared cleanup is what makes this work.' },
    { externalId: 'demo-market-c2', text: 'A weekly music night sounds fun.' },
  ],
  'demo-repair-club-003': [
    { externalId: 'demo-repair-c1', text: 'Learning to fix a flat is such a useful skill.' },
    { externalId: 'demo-repair-c2', text: 'Sharing tools makes repairs more accessible.' },
  ],
};

/** Synthetic-only fixture adapter. It never fetches or represents real platform content. */
export class MockSourceAdapter implements SourceAdapter {
  readonly platform = 'MANUAL' as const;

  constructor(
    private readonly posts: readonly NormalizedPost[] = demoPosts,
    private readonly comments: Readonly<Record<string, readonly NormalizedComment[]>> = demoComments,
  ) {
    if (process.env.NODE_ENV === 'production') throw new Error('Mock source adapters are disabled in production');
  }

  async capabilities(): Promise<SourceCapability[]> { return ['DISCOVER', 'GET_POST', 'COMMENTS', 'METRICS']; }
  async validateAccess() { return { available: true, status: 'AVAILABLE' as const, reason: 'SYNTHETIC_DEMO_FIXTURE' }; }

  async discover(rawQuery: DiscoveryQuery): Promise<{ posts: NormalizedPost[]; nextCursor?: string }> {
    const query = querySchema.parse(rawQuery);
    const terms = [...query.keywords, ...query.hashtags.map(value => value.replace(/^#/, '')), ...query.topics]
      .map(value => value.toLocaleLowerCase()).filter(Boolean);
    const filtered = this.posts.filter(post => {
      const haystack = `${post.title ?? ''} ${post.text} ${(post.topicTags ?? []).join(' ')}`.toLocaleLowerCase();
      return (!query.language || post.language?.toLocaleLowerCase() === query.language.toLocaleLowerCase()) && terms.every(term => haystack.includes(term));
    });
    const offset = query.cursor === undefined ? 0 : Number(query.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('INVALID_CURSOR');
    const posts = filtered.slice(offset, offset + query.limit);
    const nextOffset = offset + posts.length;
    return { posts: [...posts], ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}) };
  }

  async getPost(externalId: string) { return this.posts.find(post => post.externalId === externalId) ?? null; }
  async getComments(externalId: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid comment limit');
    return [...(this.comments[externalId] ?? [])].slice(0, limit);
  }
}

/** Manual imports enter through the authenticated import API, never by fetching a URL. */
export class ManualImportAdapter implements SourceAdapter {
  readonly platform = 'MANUAL' as const;
  async capabilities(): Promise<SourceCapability[]> { return []; }
  async validateAccess() { return { available: true, status: 'AVAILABLE' as const, reason: 'USER_SUPPLIED_IMPORT_ONLY' }; }
  async discover(_query: DiscoveryQuery): Promise<{ posts: NormalizedPost[]; nextCursor?: string }> { throw new Error('MANUAL_IMPORT_ONLY'); }
  async getPost(_externalId: string): Promise<NormalizedPost | null> { throw new Error('MANUAL_IMPORT_ONLY'); }
  async getComments(_externalId: string, _limit: number): Promise<NormalizedComment[]> { throw new Error('MANUAL_IMPORT_ONLY'); }
}

type ExternalPlatform = Exclude<SourcePlatform, 'MANUAL'>;
type Environment = Readonly<Record<string, string | undefined>>;

const externalSettings: Record<ExternalPlatform, { credential: string; approval: string }> = {
  REDDIT: { credential: 'REDDIT_ACCESS_TOKEN', approval: 'REDDIT_DATA_USE_APPROVED' },
  THREADS: { credential: 'THREADS_ACCESS_TOKEN', approval: 'THREADS_APP_APPROVED' },
  FACEBOOK: { credential: 'FACEBOOK_LICENSED_FEED_TOKEN', approval: 'FACEBOOK_LICENSE_APPROVED' },
};

/** Provider gate only. No network client exists until its approved official API is implemented and verified. */
export class ExternalSourceAdapter implements SourceAdapter {
  constructor(readonly platform: ExternalPlatform, private readonly env: Environment = process.env) {}
  async capabilities(): Promise<SourceCapability[]> { return []; }

  async validateAccess(): Promise<{ available: boolean; status: SourceAccessStatus; reason: string }> {
    const settings = externalSettings[this.platform];
    if (!this.env[settings.credential]?.trim()) return { available: false, status: 'NOT_CONFIGURED', reason: 'REQUIRED_CREDENTIALS_MISSING' };
    if (this.env[settings.approval] !== 'true') return { available: false, status: 'ACCESS_NOT_APPROVED', reason: 'PROVIDER_ACCESS_NOT_APPROVED' };
    return { available: false, status: 'NOT_CONFIGURED', reason: 'LIVE_ADAPTER_REQUIRES_VERIFIED_IMPLEMENTATION' };
  }

  async discover(_query: DiscoveryQuery): Promise<{ posts: NormalizedPost[]; nextCursor?: string }> { throw new Error('BLOCKED_EXTERNAL'); }
  async getPost(_externalId: string): Promise<NormalizedPost | null> { throw new Error('BLOCKED_EXTERNAL'); }
  async getComments(_externalId: string, _limit: number): Promise<NormalizedComment[]> { throw new Error('BLOCKED_EXTERNAL'); }
}

export function createSourceAdapter(platform: SourcePlatform, config: unknown, env: Environment = process.env): SourceAdapter {
  const sourceConfig = z.record(z.string(), z.unknown()).parse(config);
  if (platform === 'MANUAL' && sourceConfig.mode === 'MOCK_FIXTURE') {
    if (env.NODE_ENV === 'production') return new ManualImportAdapter();
    return new MockSourceAdapter();
  }
  if (platform === 'MANUAL') return new ManualImportAdapter();
  return new ExternalSourceAdapter(platform, env);
}

export function sourceAccessStatus(value: string): SourceAccessStatus {
  return z.enum(['AVAILABLE', 'NOT_CONFIGURED', 'ACCESS_NOT_APPROVED', 'BLOCKED_EXTERNAL']).parse(value);
}
