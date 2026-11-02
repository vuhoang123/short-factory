import { expect, it } from 'vitest';
import { selectTopComments } from './comment-selection.js';

const comments = Array.from({ length: 12 }, (_, index) => ({ id: String(index), body: `Comment ${index}`, likes: index }));
it('selects 5–10 comments by stored reactions as duration increases', () => {
  expect(selectTopComments(comments, 40).items.map((comment) => comment.id)).toEqual(['11', '10', '9', '8', '7']);
  expect(selectTopComments(comments, 90).items).toHaveLength(8);
  expect(selectTopComments(comments, 120).items).toHaveLength(10);
});
it('keeps unknown reactions honest and stable, without inventing comments or including flagged text', () => {
  const plan = selectTopComments([{ id: 'unknown', body: 'Original' }, { id: 'zero', body: 'Zero', likes: 0 }, { id: 'flagged', body: 'Flagged', likes: 200, sensitiveFlags: ['PRIVATE'] }], 40);
  expect(plan.items.map((comment) => comment.id)).toEqual(['zero', 'unknown']);
  expect(plan.selectionBasis).toBe('PARTIAL_OR_MISSING_REACTIONS');
  expect(plan.reactionsKnown).toBe(1);
  expect(() => selectTopComments([], Number.NaN)).toThrow();
});
it('excludes emoji-only reactions from automatic spoken comments', () => {
  expect(selectTopComments([{ id: 'clap', body: '👏', likes: 100 }, { id: 'text', body: 'Cùng tôn trọng nhau.', likes: 2 }], 40).items.map((comment) => comment.id)).toEqual(['text']);
});
