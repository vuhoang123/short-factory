import type { NormalizedComment, NormalizedPost } from '@shorts-factory/shared';

export const scoreWeights = {
  engagementVelocity: 0.2,
  hookCuriosity: 0.25,
  commentQuality: 0.25,
  topicRelevance: 0.15,
  shortVideoSuitability: 0.15,
} as const;

export interface ScoreFactors {
  engagementVelocity: number | null;
  hookCuriosity: number;
  commentQuality: number | null;
  topicRelevance: number | null;
  shortVideoSuitability: number;
}

export interface ContentScore {
  score: number;
  factors: ScoreFactors;
  reasoning: string;
  matchedTopics: string[];
  modelVersion: 'heuristic-v1';
}

type MetricSet = NormalizedPost['metrics'];
type ScoreInput = {
  post: Pick<NormalizedPost, 'title' | 'text' | 'publishedAt' | 'metrics' | 'topicTags'>;
  comments: readonly Pick<NormalizedComment, 'text' | 'likes'>[];
  topicTerms?: readonly string[];
  previousMetrics?: MetricSet;
  previousMeasuredAt?: Date;
  now?: Date;
};

function clamp(value: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, value)); }
function round(value: number): number { return Math.round(clamp(value)); }
function interactions(metrics: MetricSet): number | null {
  const values = [metrics.likes, metrics.comments, metrics.shares].filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function engagementVelocity(input: ScoreInput): number | null {
  const current = interactions(input.post.metrics);
  if (current === null) return null;
  const currentViews = input.post.metrics.views;
  if (input.previousMetrics && input.previousMeasuredAt && input.now) {
    const before = interactions(input.previousMetrics);
    const hours = (input.now.getTime() - input.previousMeasuredAt.getTime()) / 3_600_000;
    if (before !== null && hours > 0) {
      const delta = Math.max(0, current - before);
      if (currentViews !== undefined && input.previousMetrics.views !== undefined) {
        const viewDelta = Math.max(0, currentViews - input.previousMetrics.views);
        if (viewDelta > 0) return round(Math.log1p((delta / viewDelta) * 100) / Math.log1p(10) * 100);
      }
      return round(Math.log1p(delta / hours) / Math.log1p(10) * 100);
    }
  }
  if (!input.post.publishedAt) return null;
  const publishedAt = new Date(input.post.publishedAt).getTime();
  const now = input.now?.getTime() ?? Date.now();
  const hours = Math.max(1, (now - publishedAt) / 3_600_000);
  if (currentViews !== undefined && currentViews > 0) return round(Math.log1p((current / currentViews) * 100) / Math.log1p(10) * 100);
  return round(Math.log1p(current / hours) / Math.log1p(10) * 100);
}

function hookCuriosity(text: string): number {
  const firstLine = text.split(/[.!\n]/, 1)[0]?.trim() ?? '';
  const lower = firstLine.toLocaleLowerCase();
  const curiosity = /\b(why|how|what|could|secret|surprising|unexpected|revealed|turns out|what if)\b/.test(lower);
  return round(30 + (firstLine.includes('?') ? 30 : 0) + (curiosity ? 30 : 0) + (/\b\d+\b/.test(firstLine) ? 10 : 0));
}

function commentQuality(comments: ScoreInput['comments']): number | null {
  if (!comments.length) return null;
  const wordSets = comments.map(comment => new Set(comment.text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));
  const allWords = wordSets.flatMap(words => [...words]);
  const uniqueness = allWords.length ? new Set(allWords).size / allWords.length : 0;
  const substantive = comments.filter(comment => (comment.text.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 6).length / comments.length;
  const averageLength = comments.reduce((total, comment) => total + comment.text.trim().length, 0) / comments.length;
  return round(substantive * 50 + clamp(uniqueness / 0.65 * 100) * 0.25 + clamp(averageLength / 80 * 100) * 0.25);
}

function relevance(text: string, terms: readonly string[]): { score: number | null; matches: string[] } {
  const uniqueTerms = [...new Set(terms.map(term => term.trim().replace(/^#/, '').toLocaleLowerCase()).filter(Boolean))];
  if (!uniqueTerms.length) return { score: null, matches: [] };
  const normalized = text.toLocaleLowerCase();
  const matches = uniqueTerms.filter(term => normalized.includes(term));
  return { score: round(matches.length / uniqueTerms.length * 100), matches };
}

function shortVideoSuitability(text: string): number {
  const length = text.trim().length;
  if (length < 70) return 35;
  if (length < 400) return 80 + (length - 70) / 330 * 20;
  if (length <= 1200) return 100;
  return clamp(100 - (length - 1200) / 80);
}

export function detectSensitiveFlags(text: string): string[] {
  const flags: string[] = [];
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) flags.push('EMAIL');
  if (/(?:\+\d[\d ()-]{7,}\d|\b\d{3}[ -.]\d{3}[ -.]\d{4}\b)/.test(text)) flags.push('PHONE');
  if (/\b\d{1,5}\s+(?:[\p{L}\w.-]+\s+){0,4}(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?)\b/iu.test(text)) flags.push('POSSIBLE_ADDRESS');
  return flags;
}

export function scoreContent(input: ScoreInput): ContentScore {
  const text = `${input.post.title ?? ''}\n${input.post.text}`;
  const topicTerms = [...(input.topicTerms ?? []), ...(input.post.topicTags ?? [])];
  const topic = relevance(text, topicTerms);
  const factors: ScoreFactors = {
    engagementVelocity: engagementVelocity(input),
    hookCuriosity: hookCuriosity(text),
    commentQuality: commentQuality(input.comments),
    topicRelevance: topic.score,
    shortVideoSuitability: shortVideoSuitability(input.post.text),
  };
  const available = Object.entries(scoreWeights).filter(([key]) => factors[key as keyof ScoreFactors] !== null);
  const totalWeight = available.reduce((sum, [key]) => sum + scoreWeights[key as keyof typeof scoreWeights], 0);
  const score = round(available.reduce((sum, [key]) => sum + (factors[key as keyof ScoreFactors] ?? 0) * scoreWeights[key as keyof typeof scoreWeights], 0) / totalWeight);
  const missing = Object.entries(factors).filter(([, value]) => value === null).map(([key]) => key);
  return {
    score, factors, matchedTopics: topic.matches, modelVersion: 'heuristic-v1',
    reasoning: missing.length ? `Deterministic heuristic score; unavailable metrics were excluded: ${missing.join(', ')}.` : 'Deterministic heuristic score using all five configured factors.',
  };
}
