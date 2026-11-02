import { expect, it } from 'vitest';
import { parseCommentImport } from './comment-import';

it('imports a whole JSON or tab-separated comment collection with reactions', () => {
  expect(parseCommentImport('40\tBình luận nhiều react\n3\tBình luận thứ hai')).toEqual([{ externalId: 'c1', body: 'Bình luận nhiều react', likes: 40 }, { externalId: 'c2', body: 'Bình luận thứ hai', likes: 3 }]);
  expect(parseCommentImport('[{"body":"Đọc sách","likes":12,"externalId":"original"}]')[0]?.likes).toBe(12);
});
it('preserves text-only batches without inventing reaction counts and rejects malformed input', () => {
  expect(parseCommentImport('Một\nHai')).toEqual([{ externalId: 'c1', body: 'Một' }, { externalId: 'c2', body: 'Hai' }]);
  expect(() => parseCommentImport('[{"body":"Text","likes":-1}]')).toThrow();
  expect(() => parseCommentImport('[{"body":"Text","externalId":"one"},{"body":"Text","externalId":"one"}]')).toThrow();
});
