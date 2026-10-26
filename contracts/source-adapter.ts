export type SourcePlatform = 'REDDIT' | 'THREADS' | 'FACEBOOK' | 'MANUAL';
export type SourceCapability = 'DISCOVER' | 'GET_POST' | 'COMMENTS' | 'METRICS';
export type SourceAccessStatus = 'AVAILABLE' | 'NOT_CONFIGURED' | 'ACCESS_NOT_APPROVED' | 'BLOCKED_EXTERNAL';
export interface DiscoveryQuery { keywords: string[]; hashtags?: string[]; topics?: string[]; language?: string; cursor?: string; limit: number; }
export interface NormalizedPost {
  platform: SourcePlatform; externalId: string; canonicalUrl: string;
  title?: string; text: string; authorAlias?: string;
  language?: string; topicTags?: string[]; synthetic?: boolean;
  rawPayload?: Record<string, string | number | boolean | null>;
  publishedAt?: string; fetchedAt: string;
  metrics: { likes?: number; comments?: number; shares?: number; views?: number; };
}
export interface NormalizedComment { externalId: string; parentExternalId?: string; text: string; likes?: number; publishedAt?: string; }
export interface SourceAdapter {
  readonly platform: SourcePlatform;
  capabilities(): Promise<SourceCapability[]>;
  validateAccess(): Promise<{ available: boolean; status: SourceAccessStatus; reason?: string }>;
  discover(query: DiscoveryQuery): Promise<{ posts: NormalizedPost[]; nextCursor?: string }>;
  getPost(externalId: string): Promise<NormalizedPost | null>;
  getComments(externalId: string, limit: number): Promise<NormalizedComment[]>;
}
