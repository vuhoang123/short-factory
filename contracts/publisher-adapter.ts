export type PublishPlatform = 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';
export type PublishStatus = 'PROCESSING' | 'PUBLISHED' | 'NEEDS_ACTION' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT';
export interface PublishInput {
  publicationId: string; workspaceId: string; accountId: string; mediaAssetId: string;
  title: string; description: string; privacy: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  idempotencyKey: string; metadata?: Record<string, unknown>;
}
export interface PublishResult { status: PublishStatus; remoteId?: string; remoteUrl?: string; operationId?: string; nextCheckAt?: string; reason?: string; }
export interface PublisherAdapter {
  readonly platform: PublishPlatform;
  capabilities(accountId: string): Promise<{ directPost: boolean; supportedPrivacy: string[]; reason?: string }>;
  validateAccount(accountId: string): Promise<void>;
  validateMedia(input: PublishInput): Promise<void>;
  publish(input: PublishInput): Promise<PublishResult>;
  reconcile(publicationId: string): Promise<PublishResult>;
  getMetrics(remoteId: string): Promise<Record<string, number>>;
}
