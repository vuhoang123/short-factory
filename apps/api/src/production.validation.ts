import { storyScriptSchema, subtitlePresetSchema } from '@shorts-factory/media';
import { z } from 'zod';

const id = z.string().uuid();
const voice = z.string().min(1).max(100);

export const productionCreateSchema = z.object({
  draftOnly: z.boolean().optional(),
  commentSelection: z.enum(['MANUAL', 'TOP_REACTIONS']).optional(),
  channelId: id,
  commentIds: z.array(id).max(10).default([]),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).default('vi'),
  targetDurationSec: z.number().int().min(10).max(120).default(40),
  style: z.enum(['STORYTELLING', 'SOCIAL_COMMENTARY']).default('STORYTELLING'),
  voiceProfileId: voice,
  speakingRate: z.number().min(0.5).max(2).default(1),
  templateId: z.enum(['RedditStory', 'SocialCommentary']).default('SocialCommentary'),
  backgroundAssetId: id.nullable().optional(),
  subtitlePreset: subtitlePresetSchema.default('ClassicCaption'),
  theme: z.enum(['dark', 'light']).default('dark'),
  anonymizeAuthors: z.boolean().default(true),
  showEngagement: z.boolean().default(true),
}).strict();
export type ProductionCreate = z.infer<typeof productionCreateSchema>;

export const editStorySchema = z.object({ expectedVersion: z.number().int().positive(), script: storyScriptSchema }).strict();
export const regenerateStorySchema = z.object({
  draftOnly: z.boolean().optional(),
  commentSelection: z.enum(['MANUAL', 'TOP_REACTIONS']).optional(),
  voiceProfileId: voice.optional(),
  speakingRate: z.number().min(0.5).max(2).optional(),
  commentIds: z.array(id).max(10).optional(),
  targetDurationSec: z.number().int().min(10).max(120).optional(),
  style: z.enum(['STORYTELLING', 'SOCIAL_COMMENTARY']).optional(),
}).strict();
export const audioRequestSchema = z.object({ preview: z.literal(true).optional(), segmentIds: z.array(z.string().min(1).max(100)).max(30).optional(), voiceProfileId: voice.optional(), speakingRate: z.number().min(0.5).max(2).optional() }).strict();
export const renderRequestSchema = z.object({ templateId: z.enum(['RedditStory', 'SocialCommentary']).optional(), backgroundAssetId: id.nullable().optional(), subtitlePreset: subtitlePresetSchema.optional(), theme: z.enum(['dark', 'light']).optional(), anonymizeAuthors: z.boolean().optional(), showEngagement: z.boolean().optional() }).strict();
export const storyRenderRequestSchema = renderRequestSchema.extend({ voiceProfileId: voice.optional(), speakingRate: z.number().min(0.5).max(2).optional() });
export const videoReviewSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).strict();
export const productionRunQuerySchema = z.object({
  cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'CANCELLED', 'BLOCKED_RIGHTS', 'BLOCKED_EXTERNAL']).optional(),
}).strict();
export const cancelRunSchema = z.object({}).strict();
export const backgroundUploadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  basis: z.enum(['OWNED', 'LICENSED', 'CONSENTED']),
  attested: z.literal('true').transform(() => true),
  evidence: z.string().trim().max(2000).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.basis !== 'OWNED' && !input.evidence) ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'Provide the license or consent reference.' });
});

export const generateScriptsRequestSchema = z.object({}).strict();
export const productionTemplateIdSchema = z.enum(['RedditStory', 'SocialCommentary']);
export const uuidSchema = id;
