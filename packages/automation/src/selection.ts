import { evaluateRights, normalizeText, redactPersonalData, type RightsRecord } from '@shorts-factory/shared';
import { estimateNarrationDurationMs } from '@shorts-factory/media';
import type { AutomationRule } from './rules.js';

export interface AutomationCandidate {
  id: string;
  sourcePostId: string;
  score: number | null;
  status?: string;
  body: string;
  title?: string | null;
  sourceConfigId?: string | null;
  language?: string | null;
  topics?: readonly string[];
  publishedAt?: Date | null;
  rights: RightsRecord | null;
  sensitiveFlags?: readonly string[];
  deletedAt?: Date | null;
  factors?: { engagementVelocity?: number | null; topicRelevance?: number | null; commentQuality?: number | null; shortVideoSuitability?: number | null };
  estimatedCostUsd?: number | null;
  previousPerformance?: number | null;
}
export interface CandidateRankingContext { now?: Date; usedSourcePostIds?: readonly string[]; recentTopics?: readonly string[] }
export interface CandidateDecision { id: string; score: number; eligible: boolean; blockers: string[]; reasons: string[]; algorithmVersion: 'autopilot-ranking-v1' }

function clamp(value: number) { return Math.max(0, Math.min(100, value)); }
function tokens(text: string): Set<string> { return new Set(normalizeText(text).toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []); }
function similarity(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  return union.size ? [...left].filter((word) => right.has(word)).length / union.size : 0;
}

export function rankCandidates(candidates: readonly AutomationCandidate[], rule: AutomationRule, context: CandidateRankingContext = {}): CandidateDecision[] {
  const now = context.now ?? new Date();
  const used = new Set(context.usedSourcePostIds ?? []);
  const recentTopics = new Set((context.recentTopics ?? []).map((topic) => topic.toLocaleLowerCase()));
  return candidates.map((candidate): CandidateDecision => {
    const blockers = rule.targetPlatforms.flatMap((platform) => evaluateRights(candidate.rights, platform, now).blockers);
    const text = `${candidate.title ?? ''}\n${candidate.body}`;
    const normalized = text.toLocaleLowerCase();
    if (candidate.deletedAt) blockers.push('SOURCE_DELETED');
    if (candidate.sensitiveFlags?.length || redactPersonalData(text) !== text) blockers.push('SOURCE_SENSITIVE');
    if (candidate.status && candidate.status !== 'APPROVED') blockers.push('CANDIDATE_REVIEW_REQUIRED');
    if (candidate.score === null || !Number.isFinite(candidate.score) || candidate.score < rule.minScore) blockers.push('SCORE_BELOW_THRESHOLD');
    if (used.has(candidate.sourcePostId)) blockers.push('DUPLICATE_SOURCE');
    if (rule.sourceIds.length && (!candidate.sourceConfigId || !rule.sourceIds.includes(candidate.sourceConfigId))) blockers.push('SOURCE_NOT_ENABLED');
    if (rule.languages.length && (!candidate.language || !rule.languages.includes(candidate.language))) blockers.push('LANGUAGE_NOT_ALLOWED');
    const topicMatches = rule.topics.filter((topic) => normalized.includes(topic.toLocaleLowerCase()) || candidate.topics?.some((item) => item.toLocaleLowerCase() === topic.toLocaleLowerCase()));
    if (rule.topics.length && !topicMatches.length) blockers.push('TOPIC_NOT_ALLOWED');
    if (rule.exclusions.some((term) => normalized.includes(term.toLocaleLowerCase()))) blockers.push('CONTENT_EXCLUDED');
    const repeatedTopic = candidate.topics?.some((topic) => recentTopics.has(topic.toLocaleLowerCase())) ?? false;
    const ageHours = candidate.publishedAt ? (now.getTime() - candidate.publishedAt.getTime()) / 3_600_000 : null;
    const values: Record<keyof AutomationRule['weights'], number | null> = {
      viralScore: candidate.score,
      engagementVelocity: candidate.factors?.engagementVelocity ?? null,
      topicRelevance: candidate.factors?.topicRelevance ?? (rule.topics.length ? topicMatches.length / rule.topics.length * 100 : null),
      commentQuality: candidate.factors?.commentQuality ?? null,
      storytelling: candidate.factors?.shortVideoSuitability ?? null,
      recency: ageHours !== null && Number.isFinite(ageHours) && ageHours >= 0 ? 100 / (1 + ageHours / 24) : null,
      novelty: repeatedTopic ? 20 : 100,
      cost: candidate.estimatedCostUsd != null && Number.isFinite(candidate.estimatedCostUsd) && rule.estimatedRunCostUsd > 0 ? 100 / (1 + candidate.estimatedCostUsd / rule.estimatedRunCostUsd) : null,
      performance: candidate.previousPerformance ?? null,
    };
    const keys = Object.keys(rule.weights) as Array<keyof AutomationRule['weights']>;
    const available = keys.filter((key) => values[key] !== null && Number.isFinite(values[key]));
    const totalWeight = available.reduce((sum, key) => sum + rule.weights[key], 0);
    const score = totalWeight ? Math.round(available.reduce((sum, key) => sum + clamp(values[key] ?? 0) * rule.weights[key], 0) / totalWeight * 100) / 100 : 0;
    return { id: candidate.id, score, eligible: blockers.length === 0, blockers: [...new Set(blockers)], reasons: [
      'Configurable heuristic ranking, not a prediction of virality.',
      `Unavailable factors excluded: ${keys.filter((key) => !available.includes(key)).join(', ') || 'none'}.`,
      ...(repeatedTopic ? ['Recent topic reuse lowered the novelty factor.'] : []),
    ], algorithmVersion: 'autopilot-ranking-v1' };
  }).sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.score - left.score || left.id.localeCompare(right.id));
}

export interface SelectableComment { id: string; body: string; likes?: number | null; sensitiveFlags?: readonly string[]; externalId?: string; parentExternalId?: string | null }
export interface CommentSelectionOptions { maxCount: number; maxDurationSec: number; sourceText?: string; overrideIds?: readonly string[] }
export interface CommentSelection { commentIds: string[]; selected: Array<{ id: string; reason: string; estimatedDurationMs: number }>; excludedIds: string[]; algorithmVersion: 'comment-selection-v1' }

export function selectComments(comments: readonly SelectableComment[], options: CommentSelectionOptions): CommentSelection {
  if (!Number.isInteger(options.maxCount) || options.maxCount < 0 || options.maxCount > 8 || !Number.isFinite(options.maxDurationSec) || options.maxDurationSec < 0) throw new Error('COMMENT_SELECTION_LIMIT_INVALID');
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  if (options.overrideIds && (new Set(options.overrideIds).size !== options.overrideIds.length || options.overrideIds.some((id) => !byId.has(id)))) throw new Error('COMMENT_OVERRIDE_INVALID');
  const sourceTokens = tokens(options.sourceText ?? '');
  const scored = comments.map((comment) => {
    const words = tokens(comment.body);
    const readable = comment.body.trim().length >= 12 && comment.body.length <= 4000 && words.size >= 3;
    const safe = !comment.sensitiveFlags?.length && redactPersonalData(comment.body) === comment.body;
    const overlap = sourceTokens.size ? [...words].filter((word) => sourceTokens.has(word)).length / Math.max(1, words.size) : 0;
    const contrast = /\b(but|however|although|disagree|instead)\b|nhưng|tuy nhiên|ngược lại/iu.test(comment.body);
    const humor = /\b(funny|laugh|joke|ironic)\b|hài|cười|😂|🤣/iu.test(comment.body);
    const engagement = comment.likes != null && Number.isFinite(comment.likes) ? Math.log1p(Math.max(0, comment.likes)) : 0;
    return { comment, words, readable, safe, overlap, contrast, humor, score: overlap * 10 + Number(contrast) * 2 + Number(humor) + Math.min(3, engagement), durationMs: estimateNarrationDurationMs(comment.body) };
  });
  const ordered = options.overrideIds ? options.overrideIds.map((id) => scored.find((item) => item.comment.id === id)!).filter(Boolean) : scored.sort((left, right) => right.score - left.score || left.comment.id.localeCompare(right.comment.id));
  const selected: CommentSelection['selected'] = [];
  const selectedTokens: Set<string>[] = [];
  let durationMs = 0;
  for (const item of ordered) {
    if (!item.safe || !item.readable) {
      if (options.overrideIds) throw new Error('COMMENT_OVERRIDE_UNSAFE');
      continue;
    }
    if (selected.length >= options.maxCount || durationMs + item.durationMs > options.maxDurationSec * 1000 || selectedTokens.some((words) => similarity(words, item.words) >= 0.85)) {
      if (options.overrideIds) throw new Error('COMMENT_OVERRIDE_EXCEEDS_LIMIT_OR_DUPLICATE');
      continue;
    }
    durationMs += item.durationMs;
    selectedTokens.push(item.words);
    selected.push({ id: item.comment.id, estimatedDurationMs: item.durationMs, reason: [
      item.overlap > 0 ? 'Shares source topic terms' : 'Readable source comment',
      ...(item.contrast ? ['contrasting perspective'] : []),
      ...(item.humor ? ['humor language heuristic'] : []),
      ...(item.comment.likes != null ? ['available engagement considered'] : ['engagement unavailable']),
      ...(item.comment.parentExternalId ? ['nested reply reference preserved'] : []),
    ].join('; ') });
  }
  return { commentIds: selected.map((item) => item.id), selected, excludedIds: comments.filter((comment) => !selected.some((item) => item.id === comment.id)).map((comment) => comment.id), algorithmVersion: 'comment-selection-v1' };
}
