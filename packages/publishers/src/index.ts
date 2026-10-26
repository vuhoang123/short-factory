import type { PublisherAdapter, PublishInput, PublishPlatform, PublishResult } from '@shorts-factory/shared';

/** Contract fixture, never a production publisher. Phase 4 supplies real adapters. */
export class MockPublisherAdapter implements PublisherAdapter {
  private readonly results = new Map<string, { key: string; result: PublishResult }>();
  private readonly keys = new Map<string, string>();
  constructor(readonly platform: PublishPlatform) {
    if (process.env.NODE_ENV === 'production') throw new Error('Mock publishing is disabled in production');
  }
  async capabilities(_accountId: string) {
    return this.platform === 'TIKTOK'
      ? { directPost: false, supportedPrivacy: [], reason: 'NEEDS_ACTION: manual export/creator handoff only' }
      : { directPost: true, supportedPrivacy: ['PUBLIC', 'PRIVATE', 'UNLISTED'], reason: 'MOCK_ONLY' };
  }
  async validateAccount(accountId: string) { if (!accountId) throw new Error('Missing fixture account'); }
  async validateMedia(input: PublishInput) { if (!input.mediaAssetId) throw new Error('Missing fixture media'); }
  async publish(input: PublishInput): Promise<PublishResult> {
    if (this.platform === 'TIKTOK') return { status: 'NEEDS_ACTION', reason: 'Manual export/creator handoff required' };
    await this.validateAccount(input.accountId);
    await this.validateMedia(input);
    const existing = this.results.get(input.publicationId);
    if (existing && existing.key !== input.idempotencyKey) throw new Error('IDEMPOTENCY_CONFLICT');
    if (existing) return existing.result;
    const owner = this.keys.get(input.idempotencyKey);
    if (owner && owner !== input.publicationId) throw new Error('IDEMPOTENCY_CONFLICT');
    const result: PublishResult = { status: 'PUBLISHED', remoteId: `mock:${input.publicationId}`, reason: 'SIMULATED_TEST_RESULT' };
    this.results.set(input.publicationId, { key: input.idempotencyKey, result });
    this.keys.set(input.idempotencyKey, input.publicationId);
    return result;
  }
  async reconcile(publicationId: string): Promise<PublishResult> {
    return this.results.get(publicationId)?.result ?? { status: 'NEEDS_ACTION', reason: 'UNKNOWN_REMOTE_RESULT: investigate before retry' };
  }
  async getMetrics(_remoteId: string): Promise<Record<string, number>> { return {}; }
}
