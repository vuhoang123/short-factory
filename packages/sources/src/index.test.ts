import { expect, it } from 'vitest';
import { createSourceAdapter, ExternalSourceAdapter, ManualImportAdapter, MockSourceAdapter } from './index';

it('discovers deterministic synthetic posts with stable pagination and filters', async () => {
  const adapter = new MockSourceAdapter();
  const first = await adapter.discover({ keywords: [], limit: 2 });
  expect(first.posts.map(post => post.externalId)).toEqual(['demo-community-library-001', 'demo-night-market-002']);
  expect(first.nextCursor).toBe('2');
  expect((await adapter.discover({ keywords: [], limit: 2, cursor: first.nextCursor })).posts).toHaveLength(1);
  expect((await adapter.discover({ keywords: ['library'], limit: 10 })).posts).toHaveLength(1);
  expect(first.posts.every(post => post.synthetic === true)).toBe(true);
  expect((await adapter.getComments(first.posts[0]!.externalId, 10))).toHaveLength(3);
  await expect(adapter.discover({ keywords: [], limit: 0 })).rejects.toThrow();
  await expect(adapter.discover({ keywords: [], limit: 1, cursor: 'not-a-cursor' })).rejects.toThrow('INVALID_CURSOR');
});

it('keeps manual import separate from discovery and external providers blocked', async () => {
  const manual = new ManualImportAdapter();
  expect((await manual.validateAccess()).reason).toBe('USER_SUPPLIED_IMPORT_ONLY');
  await expect(manual.discover({ keywords: [], limit: 1 })).rejects.toThrow('MANUAL_IMPORT_ONLY');
  for (const platform of ['REDDIT', 'THREADS', 'FACEBOOK'] as const) {
    const adapter = new ExternalSourceAdapter(platform, {});
    expect(await adapter.validateAccess()).toMatchObject({ available: false, status: 'NOT_CONFIGURED' });
    expect(await adapter.capabilities()).toEqual([]);
    await expect(adapter.getPost('id')).rejects.toThrow('BLOCKED_EXTERNAL');
  }
  const reddit = new ExternalSourceAdapter('REDDIT', { REDDIT_ACCESS_TOKEN: 'configured', REDDIT_DATA_USE_APPROVED: 'false' });
  expect(await reddit.validateAccess()).toMatchObject({ status: 'ACCESS_NOT_APPROVED' });
  const approvedPlaceholder = new ExternalSourceAdapter('REDDIT', { REDDIT_ACCESS_TOKEN: 'configured', REDDIT_DATA_USE_APPROVED: 'true' });
  expect(await approvedPlaceholder.validateAccess()).toMatchObject({ status: 'NOT_CONFIGURED', reason: 'LIVE_ADAPTER_REQUIRES_VERIFIED_IMPLEMENTATION' });
  expect(createSourceAdapter('MANUAL', { mode: 'MOCK_FIXTURE' })).toBeInstanceOf(MockSourceAdapter);
  expect(createSourceAdapter('MANUAL', {})).toBeInstanceOf(ManualImportAdapter);
});
