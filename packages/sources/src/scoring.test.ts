import { expect, it } from 'vitest';
import { detectSensitiveFlags, scoreContent, scoreWeights } from './scoring';

const now = new Date('2026-10-26T12:00:00.000Z');

it('scores the five requested factors deterministically and stores an explanation', () => {
  const input = {
    now,
    post: {
      title: 'Why did a neighborhood library move?',
      text: 'How did volunteers turn an unused corner into a free book exchange? Neighbors shared shelves, helped one another, and now the reading group meets every Saturday.',
      publishedAt: '2026-10-26T10:00:00.000Z',
      metrics: { likes: 50, comments: 12, shares: 6, views: 400 },
      topicTags: ['neighborhood', 'volunteers'],
    },
    comments: [
      { text: 'I would love to help organize a shelf for our neighborhood.' },
      { text: 'This is a thoughtful way to make books more accessible.' },
    ],
    topicTerms: ['neighborhood', 'volunteers'],
    previousMetrics: { likes: 20, comments: 4, shares: 2, views: 200 },
    previousMeasuredAt: new Date('2026-10-26T11:00:00.000Z'),
  };
  const first = scoreContent(input);
  expect(scoreContent(input)).toEqual(first);
  expect(first.score).toBeGreaterThanOrEqual(0);
  expect(first.score).toBeLessThanOrEqual(100);
  expect(first.factors).toMatchObject({ hookCuriosity: 90, commentQuality: expect.any(Number), topicRelevance: 100 });
  expect(first.factors.shortVideoSuitability).toBeGreaterThan(80);
  expect(first.factors.engagementVelocity).not.toBeNull();
  expect(first.matchedTopics).toEqual(['neighborhood', 'volunteers']);
  expect(first.reasoning).toContain('all five');
  expect(Object.values(scoreWeights).reduce((sum, weight) => sum + weight, 0)).toBe(1);
});

it('excludes unavailable metrics instead of treating them as zero engagement', () => {
  const result = scoreContent({
    now,
    post: { text: 'A short synthetic story that tells us what neighbors built together.', metrics: {}, topicTags: [] },
    comments: [],
  });
  expect(result.factors.engagementVelocity).toBeNull();
  expect(result.factors.commentQuality).toBeNull();
  expect(result.factors.topicRelevance).toBeNull();
  expect(result.reasoning).toContain('were excluded');
  expect(Number.isFinite(result.score)).toBe(true);
});

it('flags common personal data without retaining or logging the source text', () => {
  expect(detectSensitiveFlags('Email test@example.org, phone +1 (555) 123-4567, at 42 Main Street')).toEqual(['EMAIL', 'PHONE', 'POSSIBLE_ADDRESS']);
  expect(detectSensitiveFlags('A volunteer brought a book shelf.')).toEqual([]);
});
