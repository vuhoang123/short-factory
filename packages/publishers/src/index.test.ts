import { afterEach, expect, it, vi } from 'vitest';
import { MockPublisherAdapter } from './index';
import type { PublishInput } from '@shorts-factory/shared';

afterEach(() => vi.unstubAllEnvs());
const input: PublishInput = { publicationId: 'publication-a', workspaceId: 'workspace-a', accountId: 'account-a', mediaAssetId: 'fixture', title: 'Owned', description: 'Fixture', privacy: 'PRIVATE', idempotencyKey: 'a:publish:1' };

it('mock replay and reconciliation do not duplicate remote results', async () => {
  const adapter = new MockPublisherAdapter('YOUTUBE');
  const first = await adapter.publish(input);
  expect(await adapter.publish(input)).toBe(first);
  expect(await adapter.reconcile(input.publicationId)).toEqual(first);
  expect((await adapter.reconcile('ambiguous')).status).toBe('NEEDS_ACTION');
  await expect(adapter.publish({ ...input, idempotencyKey: 'different' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
it('TikTok requires manual handoff and no mock is constructed in production', async () => {
  const adapter = new MockPublisherAdapter('TIKTOK');
  expect((await adapter.capabilities('account')).directPost).toBe(false);
  expect((await adapter.publish(input)).status).toBe('NEEDS_ACTION');
  vi.stubEnv('NODE_ENV', 'production');
  expect(() => new MockPublisherAdapter('YOUTUBE')).toThrow('disabled in production');
});
