import { describe, expect, it } from 'vitest';
import { createLocalImport, getOperationKey, localExportBlockers, type OperationKeys } from './local-export';

const channelId = '11111111-1111-4111-8111-111111111111';
const draft = {
  canonicalUrl: 'https://www.facebook.com/example/posts/123?tracking=removed',
  title: 'Câu chuyện có quyền sử dụng', body: 'Nội dung bài do tôi sở hữu.',
  comments: 'Bình luận một.\n\nBình luận hai.', channelId,
  basis: 'OWNED', evidence: '', territory: 'VN', allowedPlatforms: ['FACEBOOK'],
  commercialAllowed: true, attributionRequired: false, attributionText: '', attested: true,
};

describe('local export production blockers', () => {
  const ready = { canEdit: true, reviewedSource: true, hasVoice: true, hasChannel: true, sourceUnsafe: false, rightsStatus: 'APPROVED', candidate: { status: 'APPROVED', score: 80, minimumScore: 55 } };
  it('explains a below-threshold block even when rights are approved', () => {
    expect(localExportBlockers({ ...ready, candidate: { status: 'BELOW_THRESHOLD', score: 30, minimumScore: 55 } })).toEqual([
      'Bài đạt 30 điểm, thấp hơn ngưỡng 55 của kênh. Bài chưa đủ điều kiện để chọn và tạo video.',
    ]);
  });
  it('keeps the other review, role, safety and configuration gates visible', () => {
    expect(localExportBlockers({ ...ready, canEdit: false, reviewedSource: false, hasVoice: false, hasChannel: false, sourceUnsafe: true, rightsStatus: 'PENDING', candidate: null })).toHaveLength(7);
    expect(localExportBlockers({ ...ready, candidate: { ...ready.candidate, status: 'PENDING_REVIEW' } })[0]).toContain('Xác nhận chọn bài');
    expect(localExportBlockers(ready)).toEqual([]);
  });
  it('fails closed for missing scores or blocked candidate states', () => {
    expect(localExportBlockers({ ...ready, candidate: { ...ready.candidate, score: null } })[0]).toContain('chưa có điểm hợp lệ');
    for (const status of ['REJECTED', 'BLOCKED_RIGHTS', 'BLOCKED_SAFETY', 'DUPLICATE', 'BELOW_THRESHOLD']) {
      expect(localExportBlockers({ ...ready, candidate: { ...ready.candidate, status } })[0]).toContain('đang bị chặn');
    }
  });
});

describe('local export input boundary', () => {
  it('keeps Facebook links as manual provenance and normalizes the supplied comments', () => {
    const input = createLocalImport(draft);
    expect(input).toMatchObject({ platform: 'MANUAL', canonicalUrl: 'https://www.facebook.com/example/posts/123', channelId });
    expect(input.comments).toEqual([{ externalId: 'c1', body: 'Bình luận một.' }, { externalId: 'c2', body: 'Bình luận hai.' }]);
    expect(input.rights).toMatchObject({ basis: 'OWNED', attested: true, territory: 'VN' });
    expect(input.rights).not.toHaveProperty('reviewStatus');
  });
  it('accepts Threads references without fetching or claiming a connected source', () => {
    expect(createLocalImport({ ...draft, canonicalUrl: 'https://www.threads.com/@example/post/123' }).platform).toBe('MANUAL');
    expect(createLocalImport({ ...draft, canonicalUrl: 'https://www.threads.net/@example/post/123' }).platform).toBe('MANUAL');
  });
  it('preserves Facebook query-based post identity without retaining tracking parameters', () => {
    const first = createLocalImport({ ...draft, canonicalUrl: 'https://www.facebook.com/permalink.php?story_fbid=123&id=456&mibextid=tracking' });
    const another = createLocalImport({ ...draft, canonicalUrl: 'https://www.facebook.com/story.php?story_fbid=789&id=456' });
    const same = createLocalImport({ ...draft, canonicalUrl: 'https://m.facebook.com/story.php?story_fbid=123&id=456&tracking=other' });
    expect(first.canonicalUrl).toBe('https://www.facebook.com/456/posts/123');
    expect(another.canonicalUrl).toBe('https://www.facebook.com/456/posts/789');
    expect(same.canonicalUrl).toBe(first.canonicalUrl);
    expect(another.canonicalUrl).not.toBe(first.canonicalUrl);
  });
  it('rejects unsupported or incomplete query-only references before import can collapse their identity', () => {
    for (const canonicalUrl of ['https://facebook.com/permalink.php?story_fbid=123', 'https://facebook.com/story.php?story_fbid=123&id=bad%2Fid', 'https://facebook.com/photo.php?fbid=123', 'https://facebook.com/watch/?v=123', 'https://facebook.com/?id=123']) {
      expect(() => createLocalImport({ ...draft, canonicalUrl })).toThrow();
    }
  });
  it('rejects unrelated, deceptive and credential-bearing links', () => {
    for (const canonicalUrl of ['https://facebook.com.evil.example/p/1', 'https://evil.example', 'file:///post', 'https://user:pass@facebook.com/post']) {
      expect(() => createLocalImport({ ...draft, canonicalUrl })).toThrow();
    }
  });
  it('requires source text, fresh authority, commercial scope and a destination', () => {
    for (const invalid of [{ body: '' }, { attested: false }, { commercialAllowed: false }, { allowedPlatforms: [] }]) {
      expect(() => createLocalImport({ ...draft, ...invalid })).toThrow();
    }
    expect(() => createLocalImport({ ...draft, comments: Array.from({ length: 9 }, (_, i) => `Comment ${i}`).join('\n') })).toThrow();
  });
  it('requires evidence for licensed content and explicit attribution text when necessary', () => {
    expect(() => createLocalImport({ ...draft, basis: 'LICENSED' })).toThrow();
    expect(() => createLocalImport({ ...draft, attributionRequired: true })).toThrow();
    expect(createLocalImport({ ...draft, basis: 'CONSENTED', evidence: 'Permission ref 123', attributionRequired: true, attributionText: 'Tác giả cho phép' }).rights.evidence).toBe('Permission ref 123');
  });
  it('rejects client workspace overrides and unknown fields', () => {
    expect(() => createLocalImport({ ...draft, workspaceId: 'another-workspace' })).toThrow();
  });
});

describe('logical operation idempotency', () => {
  it('keeps the key through retries, rotates on payload change and stores no source text', async () => {
    const keys: OperationKeys = {};
    const first = await getOperationKey(keys, 'import', { body: 'Private story' });
    expect(await getOperationKey(keys, 'import', { body: 'Private story' })).toBe(first);
    expect(await getOperationKey(keys, 'import', { body: 'Changed story' })).not.toBe(first);
    expect(JSON.stringify(keys)).not.toContain('story');
    expect(keys.import?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
