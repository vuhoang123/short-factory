import { describe, expect, it } from 'vitest';
import { createRenderManifest, storyScriptSchema, type ScriptSource } from '@shorts-factory/media';
import type { RightsRecord } from '@shorts-factory/shared';
import { assertAutomationMayStart, assertAutomationTransition, assertBudget, assignExperimentVariant, automationRuleSchema, evaluateAutomaticPublication, evaluateExperiment, evaluateQuality, rankCandidates, schedulePreview, selectComments, zonedDateKey, type AutomationCandidate, type QualityInput } from './index.js';

const rights: RightsRecord = { basis: 'OWNED', reviewStatus: 'APPROVED', attested: true, commercialAllowed: true, allowedPlatforms: ['YOUTUBE', 'FACEBOOK', 'TIKTOK'], territory: 'WORLDWIDE' };
const rule = automationRuleSchema.parse({ voiceProfileId: 'local-vi' });
const candidate: AutomationCandidate = { id: 'a', sourcePostId: 'post-a', score: 80, status: 'APPROVED', body: 'A public source story about a memorable journey.', topics: ['travel'], language: 'vi', rights };

describe('automation configuration and control boundaries', () => {
  it('validates immutable rule values and rejects unsupported fields, timezone and malformed posting windows', () => {
    expect(rule.mode).toBe('MANUAL');
    expect(automationRuleSchema.safeParse({ voiceProfileId: 'voice', bypassRights: true }).success).toBe(false);
    expect(automationRuleSchema.safeParse({ voiceProfileId: 'voice', timezone: 'Not/AZone' }).success).toBe(false);
    expect(automationRuleSchema.safeParse({ voiceProfileId: 'voice', postingTimes: ['25:00'] }).success).toBe(false);
    expect(automationRuleSchema.safeParse({ voiceProfileId: 'voice', dailyBudgetUsd: 100, monthlyBudgetUsd: 50 }).success).toBe(false);
  });
  it('prevents scheduled manual work, paused work and invalid workflow restarts', () => {
    expect(() => assertAutomationMayStart('PAUSED', 'FULL_AUTO')).toThrow('AUTOMATION_PAUSED');
    expect(() => assertAutomationMayStart('STOPPED', 'SEMI_AUTO')).toThrow('EMERGENCY_STOP');
    expect(() => assertAutomationMayStart('ACTIVE', 'MANUAL', true)).toThrow('MANUAL_MODE');
    expect(() => assertAutomationTransition('SUCCEEDED', 'RUNNING')).toThrow('AUTOMATION_TRANSITION_INVALID');
    expect(() => assertAutomationTransition('WAITING_PRODUCTION', 'RUNNING')).not.toThrow();
  });
  it('counts reservations with spent usage and refuses invalid money', () => {
    expect(() => assertBudget({ dailySpentUsd: 4, monthlySpentUsd: 10, reservedUsd: 0.5, requestedUsd: 0.5, dailyLimitUsd: 5, monthlyLimitUsd: 50 })).not.toThrow();
    expect(() => assertBudget({ dailySpentUsd: 4, monthlySpentUsd: 10, reservedUsd: 0.5, requestedUsd: 0.51, dailyLimitUsd: 5, monthlyLimitUsd: 50 })).toThrow('DAILY_BUDGET_EXCEEDED');
    expect(() => assertBudget({ dailySpentUsd: 0, monthlySpentUsd: 49.9, reservedUsd: 0, requestedUsd: 0.2, dailyLimitUsd: 5, monthlyLimitUsd: 50 })).toThrow('MONTHLY_BUDGET_EXCEEDED');
    expect(() => assertBudget({ dailySpentUsd: NaN, monthlySpentUsd: 0, reservedUsd: 0, requestedUsd: 0, dailyLimitUsd: 5, monthlyLimitUsd: 50 })).toThrow('BUDGET_VALUE_INVALID');
  });
});

describe('candidate and original-comment selection', () => {
  it('ranks deterministically, excludes unavailable metrics, and never promotes unknown rights', () => {
    const decisions = rankCandidates([candidate, { ...candidate, id: 'unknown', score: 99, rights: null }], rule, { now: new Date('2026-10-27T00:00:00Z') });
    expect(decisions[0]).toMatchObject({ id: 'a', eligible: true });
    expect(decisions[1]?.blockers).toContain('UNKNOWN_RIGHTS');
    expect(decisions[0]?.reasons.join()).toContain('Unavailable factors excluded');
    const duplicate = rankCandidates([candidate], rule, { usedSourcePostIds: ['post-a'] })[0];
    expect(duplicate?.blockers).toContain('DUPLICATE_SOURCE');
    const newer = rankCandidates([{ ...candidate, id: 'recent', publishedAt: new Date('2026-10-27T00:00:00Z') }, { ...candidate, id: 'old', publishedAt: new Date('2025-01-01T00:00:00Z') }], rule, { now: new Date('2026-10-27T01:00:00Z') });
    expect(newer[0]?.id).toBe('recent');
  });
  it('preserves safe comment IDs, removes duplicates and enforces manual override safety and duration', () => {
    const comments = [
      { id: 'c1', body: 'A memorable journey is worth sharing with everyone.', likes: 5 },
      { id: 'c2', body: 'A memorable journey is worth sharing with everyone!', likes: 1 },
      { id: 'c3', body: 'But this journey sounds more difficult than expected.', parentExternalId: 'c1' },
      { id: 'unsafe', body: 'Ask me at private@example.org for all the details.', likes: 100 },
    ];
    const selected = selectComments(comments, { maxCount: 3, maxDurationSec: 15, sourceText: candidate.body });
    expect(selected.commentIds).toEqual(['c1', 'c3']);
    expect(selected.excludedIds).toContain('c2');
    expect(selected.excludedIds).toContain('unsafe');
    expect(selected.selected[1]?.reason).toContain('nested reply');
    expect(() => selectComments(comments, { maxCount: 2, maxDurationSec: 15, overrideIds: ['unknown'] })).toThrow('COMMENT_OVERRIDE_INVALID');
    expect(() => selectComments(comments, { maxCount: 2, maxDurationSec: 15, overrideIds: ['unsafe'] })).toThrow('COMMENT_OVERRIDE_UNSAFE');
    expect(() => selectComments(comments, { maxCount: 1, maxDurationSec: 1, overrideIds: ['c1'] })).toThrow('COMMENT_OVERRIDE_EXCEEDS_LIMIT');
  });
});

describe('timezone schedule preview', () => {
  it('applies local calendar caps, account cooldown and existing conflicts', () => {
    const slots = schedulePreview({ now: new Date('2026-10-27T00:00:00Z'), timezone: 'Asia/Ho_Chi_Minh', postingTimes: ['09:00', '09:30'], count: 2, existing: [{ at: new Date('2026-10-27T02:00:00Z'), accountId: 'account' }], accountId: 'account', cooldownMinutes: 60, dailyLimit: 1 });
    expect(slots.map((slot) => slot.toISOString())).toEqual(['2026-10-28T02:00:00.000Z', '2026-10-29T02:00:00.000Z']);
    expect(zonedDateKey(new Date('2026-10-27T23:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-28');
  });
  it('skips nonexistent DST wall times and schedules a repeated fall-back time only once', () => {
    const spring = schedulePreview({ now: new Date('2026-03-08T00:00:00Z'), timezone: 'America/New_York', postingTimes: ['02:30'], count: 1, existing: [], cooldownMinutes: 1, dailyLimit: 2, horizonDays: 2 });
    expect(spring[0]?.toISOString()).toBe('2026-03-09T06:30:00.000Z');
    const fall = schedulePreview({ now: new Date('2026-11-01T00:00:00Z'), timezone: 'America/New_York', postingTimes: ['01:30'], count: 2, existing: [], cooldownMinutes: 1, dailyLimit: 2, horizonDays: 2 });
    expect(fall.map((slot) => slot.toISOString())).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
  });
});

function qualityFixture(): QualityInput {
  const source: ScriptSource = { id: '11111111-1111-4111-8111-111111111111', platform: 'MANUAL', title: 'A journey', body: 'A memorable journey is worth sharing with everyone.', comments: [] };
  const script = storyScriptSchema.parse({ version: 1, language: 'en', title: source.title, targetDurationSec: 10, segments: [
    { id: 'post', type: 'POST', text: source.body, narrationType: 'VERBATIM', sourceRefs: [`post:${source.id}`] },
    { id: 'outro', type: 'OUTRO', text: 'What would you choose?', narrationType: 'ORIGINAL_COMMENTARY', sourceRefs: [] },
  ] });
  const audioAssets = [
    { assetId: '22222222-2222-4222-8222-222222222222', segmentId: 'post', durationMs: 5000 },
    { assetId: '33333333-3333-4333-8333-333333333333', segmentId: 'outro', durationMs: 5000 },
  ];
  const { manifest } = createRenderManifest({ storyProjectId: '44444444-4444-4444-8444-444444444444', storyVersionId: '55555555-5555-4555-8555-555555555555', storyVersion: 1, sourcePostId: source.id, platform: 'MANUAL', script, templateId: 'SocialCommentary', backgroundAssetId: null, attribution: { required: false, text: null }, audioAssets, subtitlePreset: 'ClassicCaption' });
  return { source, script, manifest, rights, platforms: ['YOUTUBE'], media: { width: 1080, height: 1920, fps: 30, codec: 'h264', audioCodec: 'aac', durationMs: manifest.durationFrames / 30 * 1000, sizeBytes: 5000, readable: true }, availableAssetIds: audioAssets.map((asset) => asset.assetId), maxSilentMs: 100, timingPrecision: 'PROVIDER', audioProvider: 'local' };
}

describe('quality and automatic publication gates', () => {
  it('scores measured technical checks and blocks unavailable rights, missing assets and fabricated comments', () => {
    const input = qualityFixture();
    expect(evaluateQuality(input)).toMatchObject({ status: 'PASS', score: 100 });
    expect(evaluateQuality({ ...input, rights: null }).status).toBe('BLOCKED');
    expect(evaluateQuality({ ...input, availableAssetIds: [] }).status).toBe('BLOCKED');
    const unknownSilence = evaluateQuality({ ...input, maxSilentMs: undefined, timingPrecision: 'APPROXIMATE' });
    expect(unknownSilence.status).toBe('NEEDS_REVIEW');
    expect(unknownSilence.issues.map((issue) => issue.code)).toContain('AUDIO_SILENCE');
    const script = storyScriptSchema.parse(input.script);
    script.segments[0] = { ...script.segments[0]!, type: 'COMMENT', text: 'An invented authentic comment', sourceRefs: ['comment:missing'], narrationType: 'VERBATIM' };
    expect(evaluateQuality({ ...input, script }).issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_GROUNDING', severity: 'BLOCKED' }));
  });
  it('cannot use a high quality score to bypass approval, emergency stop or TikTok creator actions', () => {
    const automatic = automationRuleSchema.parse({ voiceProfileId: 'local', mode: 'FULL_AUTO', autoPublishAuthorized: true });
    const input = { rule: automatic, videoReviewStatus: 'PENDING', quality: { status: 'PASS' as const, score: 100 }, rights, platform: 'YOUTUBE' as const, capabilities: { directPost: true, authorized: true } };
    expect(evaluateAutomaticPublication(input).blockers).toContain('VIDEO_REVIEW_REQUIRED');
    expect(evaluateAutomaticPublication({ ...input, videoReviewStatus: 'APPROVED', emergencyStopped: true }).blockers).toContain('EMERGENCY_STOP');
    expect(evaluateAutomaticPublication({ ...input, videoReviewStatus: 'APPROVED', platform: 'TIKTOK' }).blockers).toContain('TIKTOK_CREATOR_ACTION_REQUIRED');
    expect(evaluateAutomaticPublication({ ...input, videoReviewStatus: 'APPROVED', rights: null }).eligible).toBe(false);
    expect(evaluateAutomaticPublication({ ...input, videoReviewStatus: 'APPROVED' }).eligible).toBe(true);
  });
});

describe('controlled experiment evidence', () => {
  it('assigns content deterministically regardless of variant order and refuses repeated content outcomes', () => {
    expect(assignExperimentVariant('experiment', 'story', ['b', 'a'])).toBe(assignExperimentVariant('experiment', 'story', ['a', 'b']));
    expect(() => evaluateExperiment([{ variantId: 'a', contentId: 'same', value: 10 }, { variantId: 'b', contentId: 'same', value: 20 }], ['a', 'b'])).toThrow('EXPERIMENT_CONTENT_REUSED');
  });
  it('reports insufficient samples and uncertainty instead of declaring tiny-sample winners', () => {
    expect(evaluateExperiment([{ variantId: 'a', contentId: 'a1', value: 1000 }, { variantId: 'b', contentId: 'b1', value: 1 }], ['a', 'b'])).toMatchObject({ status: 'INSUFFICIENT_DATA', leadingVariantId: null });
    const outcomes = Array.from({ length: 12 }, (_, index) => [{ variantId: 'a', contentId: `a${index}`, value: 100 + index }, { variantId: 'b', contentId: `b${index}`, value: 10 + index }]).flat();
    const result = evaluateExperiment(outcomes, ['a', 'b']);
    expect(result.status).toBe('OBSERVED_DIFFERENCE');
    expect(result.samples[0]?.interval95).not.toBeNull();
    expect(result.note).toContain('not causal proof');
  });
});
