import { assertGroundedScript, renderManifestSchema, storyScriptSchema, type RenderResult, type ScriptSource } from '@shorts-factory/media';
import { evaluateRights, redactPersonalData, type RightsRecord } from '@shorts-factory/shared';
import type { AutomationRule } from './rules.js';

export interface QualityIssue { code: string; severity: 'BLOCKED' | 'REVIEW'; message: string }
export interface QualityReport {
  version: 'quality-v1';
  status: 'PASS' | 'NEEDS_REVIEW' | 'BLOCKED';
  score: number;
  issues: QualityIssue[];
  checks: Array<{ code: string; passed: boolean | null; mandatory: boolean }>;
}
export interface QualityInput {
  media: RenderResult & { readable: boolean };
  manifest: unknown;
  script: unknown;
  source: ScriptSource;
  rights: RightsRecord | null;
  platforms: readonly string[];
  minDurationSec?: number;
  maxDurationSec?: number;
  minScore?: number;
  availableAssetIds?: readonly string[];
  backgroundRightsApproved?: boolean | null;
  maxSilentMs?: number | null;
  timingPrecision?: 'PROVIDER' | 'APPROXIMATE';
  audioProvider?: string;
  now?: Date;
}

export function evaluateQuality(input: QualityInput): QualityReport {
  const checks: QualityReport['checks'] = [];
  const issues: QualityIssue[] = [];
  const check = (code: string, passed: boolean | null, mandatory: boolean, message: string) => {
    checks.push({ code, passed, mandatory });
    if (passed !== true) issues.push({ code, severity: passed === false && mandatory ? 'BLOCKED' : 'REVIEW', message });
  };
  const media = input.media;
  check('MEDIA_READABLE', media.readable && media.sizeBytes >= 1024, true, 'The MP4 must exist, be readable and contain media bytes.');
  check('MEDIA_CODECS', media.codec === 'h264' && media.audioCodec === 'aac', true, 'H.264 video and an AAC audio stream are required.');
  check('MEDIA_VERTICAL', media.width > 0 && media.height > 0 && Math.abs(media.width / media.height - 9 / 16) < 0.001 && media.fps > 0, true, 'The output must have valid 9:16 dimensions and frame rate.');
  check('MEDIA_DURATION', Number.isFinite(media.durationMs) && media.durationMs >= (input.minDurationSec ?? 10) * 1000 && media.durationMs <= (input.maxDurationSec ?? 120) * 1000, true, 'Video duration is outside the configured range.');
  check('SOURCE_PRIVACY', ![input.source.title ?? '', input.source.body, ...input.source.comments.map((comment) => comment.body)].some((text) => redactPersonalData(text) !== text), true, 'Source material contains personal data requiring removal.');
  check('RIGHTS_APPROVED', input.platforms.length > 0 && input.platforms.every((platform) => evaluateRights(input.rights, platform, input.now).eligible), true, 'Current reviewed source rights must allow every intended platform.');
  const script = storyScriptSchema.safeParse(input.script);
  const manifest = renderManifestSchema.safeParse(input.manifest);
  check('SCRIPT_VALID', script.success, true, 'Script data must satisfy its versioned schema.');
  check('MANIFEST_VALID', manifest.success, true, 'Render manifest must satisfy its versioned schema.');
  if (script.success) {
    let grounded = true;
    try { assertGroundedScript(script.data, input.source); } catch { grounded = false; }
    grounded = grounded && script.data.segments.every((segment) => segment.type !== 'COMMENT' || segment.narrationType === 'VERBATIM');
    check('SOURCE_GROUNDING', grounded, true, 'Quotes and source references must match the original material.');
    check('PARAPHRASE_REVIEW', !script.data.segments.some((segment) => segment.narrationType === 'PARAPHRASE'), false, 'Paraphrased meaning requires editorial review; structural grounding does not establish semantic accuracy.');
    check('SCRIPT_PRIVACY', script.data.segments.every((segment) => redactPersonalData(segment.text) === segment.text), true, 'Narration contains personal data requiring removal.');
  }
  if (manifest.success) {
    const value = manifest.data;
    const endMs = value.durationFrames / value.fps * 1000;
    check('MANIFEST_MEDIA_MATCH', value.width === media.width && value.height === media.height && value.fps === media.fps && Math.abs(endMs - media.durationMs) <= 100, true, 'Measured output and frozen manifest metadata must agree.');
    check('MANIFEST_SOURCE_MATCH', value.sourcePostId === input.source.id, true, 'The manifest must cite this source post.');
    if (script.success) check('MANIFEST_SCRIPT_MATCH', script.data.version === value.storyVersion && script.data.segments.length === value.visualSegments.length && script.data.segments.every((segment, index) => {
      const visual = value.visualSegments[index];
      return visual?.id === segment.id && visual.type === segment.type && visual.text === segment.text && visual.narrationType === segment.narrationType && JSON.stringify(visual.sourceRefs) === JSON.stringify(segment.sourceRefs);
    }), true, 'The rendered segments must match the frozen script version.');
    check('SUBTITLE_TIMING', value.subtitleTimeline.length > 0 && value.subtitleTimeline.every((cue, index, cues) => cue.startMs >= 0 && cue.endMs <= endMs + 1 && (index === 0 || cue.startMs >= (cues[index - 1]?.endMs ?? 0)) && value.visualSegments.some((segment) => segment.id === cue.segmentId) && (cue.words?.every((word) => word.startMs >= cue.startMs && word.endMs <= cue.endMs && word.endMs > word.startMs) ?? true)), true, 'Subtitle cues must be ordered and inside the narration timeline.');
    check('SUBTITLE_OVERFLOW', value.subtitleTimeline.every((cue) => cue.text.length <= 100 && cue.text.split(/\s+/u).every((word) => Array.from(word).length <= 32)), false, 'Long captions or words need a visual overflow check.');
    const requiredAssets = [...value.audioAssets.map((asset) => asset.assetId), ...(value.backgroundAssetId ? [value.backgroundAssetId] : [])];
    check('REQUIRED_ASSETS', input.availableAssetIds ? requiredAssets.every((id) => input.availableAssetIds?.includes(id)) && value.audioAssets.length > 0 : null, true, 'Every referenced audio/background asset must be present and readable.');
    if (value.backgroundAssetId) check('BACKGROUND_RIGHTS', input.backgroundRightsApproved === true, true, 'Background usage rights must be verified.');
    if (input.rights?.attributionRequired) check('ATTRIBUTION', value.attribution.required && value.attribution.text === input.rights.attributionText, true, 'The required source attribution must appear in the manifest.');
  }
  check('AUDIO_SILENCE', input.maxSilentMs == null ? null : Number.isFinite(input.maxSilentMs) && input.maxSilentMs <= 3000, false, 'An audio silence measurement or human review is required; timeline estimates do not measure silence.');
  check('TIMING_PRECISION', input.timingPrecision === 'PROVIDER', false, 'Approximate or unrecorded subtitle timing needs human review.');
  check('NARRATION_PROVIDER', input.audioProvider ? input.audioProvider !== 'mock' && !input.audioProvider.includes('mock') : null, true, 'A test tone or unknown provider is not verified narration.');
  const score = Math.max(0, Math.round(100 - issues.reduce((sum, issue) => sum + (issue.severity === 'BLOCKED' ? 25 : 5), 0)));
  return { version: 'quality-v1', status: issues.some((issue) => issue.severity === 'BLOCKED') ? 'BLOCKED' : issues.length || score < (input.minScore ?? 80) ? 'NEEDS_REVIEW' : 'PASS', score, issues, checks };
}

export interface PublicationGateInput {
  rule: AutomationRule;
  videoReviewStatus: string;
  quality: Pick<QualityReport, 'status' | 'score'>;
  rights: RightsRecord | null;
  platform: 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';
  capabilities: { directPost: boolean; authorized: boolean; creatorConsent?: boolean; productApproved?: boolean };
  emergencyStopped?: boolean;
  now?: Date;
}

export function evaluateAutomaticPublication(input: PublicationGateInput): { eligible: boolean; blockers: string[] } {
  const blockers = [...evaluateRights(input.rights, input.platform, input.now).blockers];
  if (input.emergencyStopped) blockers.push('EMERGENCY_STOP');
  if (input.rule.mode !== 'FULL_AUTO' || !input.rule.autoPublishAuthorized) blockers.push('AUTOMATIC_PUBLICATION_NOT_AUTHORIZED');
  if (input.videoReviewStatus !== 'APPROVED') blockers.push('VIDEO_REVIEW_REQUIRED');
  if (input.quality.status !== 'PASS' || input.quality.score < input.rule.minQualityScore) blockers.push('QUALITY_REVIEW_REQUIRED');
  if (!input.capabilities.directPost || !input.capabilities.authorized) blockers.push('BLOCKED_EXTERNAL');
  if (input.platform === 'TIKTOK' && (!input.capabilities.creatorConsent || !input.capabilities.productApproved)) blockers.push('TIKTOK_CREATOR_ACTION_REQUIRED');
  return { eligible: blockers.length === 0, blockers: [...new Set(blockers)] };
}
