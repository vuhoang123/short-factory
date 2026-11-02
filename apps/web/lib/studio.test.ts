import { describe, expect, it } from 'vitest';
import { studioLink, studioSelection } from './studio';

describe('Studio selection links', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  it('preserves the exact selected post order and current run across a round trip', () => {
    const link = new URL(studioLink({ postIds: [second, first], runId: first }), 'http://localhost');
    expect(studioSelection(Object.fromEntries(link.searchParams))).toEqual({ postIds: [second, first], runId: first });
    expect(studioSelection({ posts: `${first},${first}` }).postIds).toEqual([first]);
  });
  it('rejects invalid identifiers and an unbounded bulk selection', () => {
    expect(() => studioSelection({ posts: 'not-a-post' })).toThrow();
    expect(() => studioSelection({ run: '../secret' })).toThrow();
    const ids = Array.from({ length: 13 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    expect(() => studioSelection({ posts: ids.join(',') })).toThrow();
  });
});
