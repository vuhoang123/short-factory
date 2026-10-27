import { z } from 'zod';

export const storySegmentTypeSchema = z.enum(['HOOK', 'INTRO', 'POST', 'COMMENT', 'TRANSITION', 'COMMENTARY', 'OUTRO']);
export const narrationTypeSchema = z.enum(['VERBATIM', 'PARAPHRASE', 'ORIGINAL_COMMENTARY']);

export const storySegmentSchema = z.object({
  id: z.string().min(1).max(100),
  type: storySegmentTypeSchema,
  text: z.string().trim().min(1).max(4000),
  sourceRefs: z.array(z.string().min(1).max(220)).max(20),
  narrationType: narrationTypeSchema,
  estimatedDurationMs: z.number().int().positive().optional(),
  voiceProfileId: z.string().max(100).optional(),
  displayStyle: z.string().max(100).optional(),
}).strict();

export const storyScriptSchema = z.object({
  version: z.number().int().positive(),
  language: z.string().min(2).max(20),
  title: z.string().trim().min(1).max(300),
  targetDurationSec: z.number().int().min(10).max(120),
  segments: z.array(storySegmentSchema).min(2).max(30),
}).strict().superRefine((script, ctx) => {
  const ids = new Set<string>();
  for (const [index, segment] of script.segments.entries()) {
    if (ids.has(segment.id)) ctx.addIssue({ code: 'custom', path: ['segments', index, 'id'], message: 'Segment IDs must be unique.' });
    ids.add(segment.id);
  }
});
export type StoryScript = z.infer<typeof storyScriptSchema>;
export type StorySegment = z.infer<typeof storySegmentSchema>;

export const subtitleWordSchema = z.object({ text: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict();
export const subtitleCueSchema = z.object({
  id: z.string().min(1),
  segmentId: z.string().min(1),
  text: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  words: z.array(subtitleWordSchema).optional(),
}).strict().refine((cue) => cue.endMs > cue.startMs, 'Subtitle cue must have a positive duration.');
export const subtitlePresetSchema = z.enum(['ClassicCaption', 'KaraokeHighlight']);
export type SubtitleCue = z.infer<typeof subtitleCueSchema>;
export type SubtitlePreset = z.infer<typeof subtitlePresetSchema>;

const frameSegmentSchema = z.object({
  id: z.string(), type: storySegmentTypeSchema, text: z.string(), sourceRefs: z.array(z.string()),
  narrationType: narrationTypeSchema, startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(),
}).strict().refine((segment) => segment.endFrame > segment.startFrame, 'Visual segment must have a positive duration.');

export const renderManifestSchema = z.object({
  version: z.literal(1),
  templateId: z.enum(['RedditStory', 'SocialCommentary']),
  templateVersion: z.number().int().positive(),
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.literal(30),
  durationFrames: z.number().int().positive().max(216000),
  storyProjectId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  storyVersion: z.number().int().positive(),
  platform: z.enum(['MANUAL', 'REDDIT', 'THREADS', 'FACEBOOK']),
  sourcePostId: z.string().uuid(),
  title: z.string().min(1).max(300),
  backgroundAssetId: z.string().uuid().nullable(),
  attribution: z.object({ required: z.boolean(), text: z.string().nullable() }).strict(),
  visualSettings: z.object({ theme: z.enum(['dark', 'light']), anonymizeAuthors: z.boolean(), showEngagement: z.boolean() }).strict(),
  audioAssets: z.array(z.object({ assetId: z.string().uuid(), segmentId: z.string().min(1), startFrame: z.number().int().nonnegative(), durationFrames: z.number().int().positive() }).strict()),
  subtitlePreset: subtitlePresetSchema,
  subtitleTimeline: z.array(subtitleCueSchema),
  visualSegments: z.array(frameSegmentSchema).min(1),
  animations: z.array(z.enum(['FADE', 'SLIDE', 'SCALE', 'SEQUENTIAL_COMMENTS'])),
  audioLevels: z.object({ narration: z.number().min(0).max(2), background: z.number().min(0).max(1) }).strict(),
  rendering: z.object({ videoCodec: z.literal('h264'), audioCodec: z.literal('aac'), pixelFormat: z.literal('yuv420p') }).strict(),
}).strict().superRefine((manifest, ctx) => {
  for (const [index, segment] of manifest.visualSegments.entries()) {
    if (segment.endFrame > manifest.durationFrames) ctx.addIssue({ code: 'custom', path: ['visualSegments', index, 'endFrame'], message: 'Visual segment exceeds the manifest duration.' });
  }
  for (const [index, audio] of manifest.audioAssets.entries()) {
    if (audio.startFrame + audio.durationFrames > manifest.durationFrames) ctx.addIssue({ code: 'custom', path: ['audioAssets', index], message: 'Audio asset exceeds the manifest duration.' });
  }
});
export type RenderManifest = z.infer<typeof renderManifestSchema>;

export const productionInputSchema = z.object({
  mode: z.enum(['CREATE', 'REGENERATE', 'RENDER', 'AUDIO_ONLY']),
  candidateId: z.string().uuid().nullable(),
  channelId: z.string().uuid(),
  commentIds: z.array(z.string().uuid()).max(8),
  language: z.string().min(2).max(20),
  targetDurationSec: z.number().int().min(10).max(120),
  style: z.enum(['STORYTELLING', 'SOCIAL_COMMENTARY']),
  voiceProfileId: z.string().min(1).max(100),
  voiceId: z.string().min(1).max(100),
  speakingRate: z.number().min(0.5).max(2),
  templateId: z.enum(['RedditStory', 'SocialCommentary']),
  backgroundAssetId: z.string().uuid().nullable(),
  subtitlePreset: subtitlePresetSchema,
  theme: z.enum(['dark', 'light']),
  anonymizeAuthors: z.boolean(),
  showEngagement: z.boolean(),
  selectedSegmentIds: z.array(z.string().min(1).max(100)).max(30),
  storyVersionId: z.string().uuid().nullable(),
}).strict();
export type ProductionInput = z.infer<typeof productionInputSchema>;

export const compositionInputSchema = z.object({
  manifest: renderManifestSchema,
  post: z.object({ title: z.string().nullable(), body: z.string(), authorAlias: z.string().nullable() }).strict(),
  comments: z.array(z.object({ id: z.string(), body: z.string(), authorAlias: z.string().nullable() }).strict()),
  backgroundSrc: z.string().nullable(),
  audioSources: z.record(z.string(), z.string()),
}).strict();
export type CompositionInput = z.infer<typeof compositionInputSchema>;
