import { canonicalUrlSchema } from '@shorts-factory/shared';
import { z } from 'zod';

const id = z.string().uuid();
const destination = z.enum(['YOUTUBE', 'FACEBOOK', 'TIKTOK']);
const normalText = (max: number) => z.string().trim().min(1).max(max);

export const authSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
}).strict();
export const registerSchema = authSchema.extend({ name: normalText(100).optional() });
export const workspaceSchema = z.object({ name: normalText(100), slug: z.string().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict();
export const switchWorkspaceSchema = z.object({ workspaceId: id }).strict();
export const channelSchema = z.object({
  workspaceId: id.optional(),
  name: normalText(100),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).default('vi'),
  topicConfig: z.object({ keywords: z.array(normalText(80)).max(100).optional(), allow: z.array(normalText(80)).max(100).optional(), deny: z.array(normalText(80)).max(100).optional() }).strict().default({}),
  minimumCandidateScore: z.number().min(0).max(100).default(55),
  automationConfig: z.object({ enabled: z.literal(false).default(false) }).strict().default({ enabled: false }),
}).strict();
export const sourceSchema = z.object({
  workspaceId: id.optional(), channelId: id.optional(),
  platform: z.enum(['MANUAL', 'REDDIT', 'THREADS', 'FACEBOOK']), sourceKey: normalText(150),
  config: z.object({
    description: z.string().trim().max(1000).optional(), mode: z.enum(['USER_SUPPLIED', 'MOCK_FIXTURE']).optional(),
    keywords: z.array(normalText(80)).max(100).default([]), hashtags: z.array(normalText(80)).max(100).default([]),
    topics: z.array(normalText(80)).max(100).default([]), language: z.string().trim().max(20).optional(),
    retainRawPayload: z.boolean().default(false),
  }).strict().default({ keywords: [], hashtags: [], topics: [], retainRawPayload: false }),
  enabled: z.boolean().default(false),
  syncFrequencyMinutes: z.number().int().min(5).max(10080).default(1440),
}).strict();
export const updateSourceSchema = sourceSchema.omit({ platform: true }).partial().extend({ channelId: id.nullable().optional() }).strict();
export const sourceVerifySchema = z.object({}).strict();
export const topicRuleSchema = z.object({
  workspaceId: id.optional(), channelId: id, name: normalText(100), keywords: z.array(normalText(80)).max(100).default([]),
  hashtags: z.array(normalText(80)).max(100).default([]), topics: z.array(normalText(80)).max(100).default([]),
  language: z.string().trim().max(20).optional(), allow: z.array(normalText(80)).max(100).default([]),
  deny: z.array(normalText(80)).max(100).default([]), minimumScore: z.number().min(0).max(100).default(55), enabled: z.boolean().default(true),
}).strict();
export const updateTopicRuleSchema = topicRuleSchema.omit({ workspaceId: true, channelId: true }).partial().strict();
export const candidateQuerySchema = z.object({
  cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), q: z.string().trim().max(200).optional(),
  platform: z.enum(['MANUAL', 'REDDIT', 'THREADS', 'FACEBOOK']).optional(), topic: z.string().trim().max(80).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(), rightsStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'BLOCKED']).optional(),
  candidateStatus: z.string().trim().max(40).optional(), sort: z.enum(['SCORE_DESC', 'SCORE_ASC', 'NEWEST']).default('SCORE_DESC'),
}).strict();
export const candidateReviewSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).strict();
export const syncKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
export function isSafeMetadataUrl(value: string): boolean {
  return canonicalUrlSchema.safeParse(value).success;
}

export const rightsSchema = z.object({
  basis: z.enum(['OWNED', 'LICENSED', 'CONSENTED', 'EXCEPTION_REVIEWED', 'UNKNOWN']).default('UNKNOWN'),
  commercialAllowed: z.boolean().default(false), allowedPlatforms: z.array(destination).max(3).default([]),
  attested: z.boolean().default(false), attestation: z.boolean().optional(),
  evidence: z.string().trim().min(1).max(4000).optional(),
  territory: normalText(100).default('UNSPECIFIED'),
  attributionRequired: z.boolean().default(false), attributionText: z.string().trim().max(2000).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(), evidenceAssetId: id.optional(),
}).strict().transform(({ attestation, ...rights }) => ({ ...rights, attested: attestation ?? rights.attested }));

const importFields = {
  workspaceId: id.optional(), channelId: id.optional(), sourceConfigId: id.optional(),
  title: z.string().trim().max(300).optional(), body: normalText(50000),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  comments: z.array(z.object({ externalId: normalText(200), parentExternalId: normalText(200).optional(), body: normalText(10000), likes: z.number().int().nonnegative().optional(), publishedAt: z.string().datetime({ offset: true }).optional() }).strict()).max(500).default([]),
  rights: rightsSchema,
};
const canonical = z.string().max(2048).url().refine(isSafeMetadataUrl, 'Use a public HTTP(S) URL without credentials, private hosts or fragments.');
const flatImport = z.object({ ...importFields, platform: z.literal('MANUAL').default('MANUAL'), externalPostId: normalText(200).optional(), canonicalUrl: canonical }).strict();
const nestedImport = z.object({ ...importFields, source: z.object({ platform: z.literal('MANUAL'), canonicalUrl: canonical, externalPostId: normalText(200).optional() }).strict() }).strict().transform(({ source, ...value }) => ({ ...value, ...source }));
export const manualImportSchema = z.union([flatImport, nestedImport]).superRefine((value, ctx) => {
  if (value.rights.basis !== 'UNKNOWN' && !value.rights.attested) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rights', 'attested'], message: 'An explicit rights attestation is required.' });
  if (new Set(value.comments.map((comment) => comment.externalId)).size !== value.comments.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comments'], message: 'Comment IDs must be unique in an import.' });
});
export type ManualImport = z.infer<typeof manualImportSchema>;

export const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']), evidence: z.string().trim().max(4000).optional(),
  territory: z.string().trim().max(100).optional(), attributionText: z.string().trim().max(2000).optional(),
  basis: z.enum(['OWNED', 'LICENSED', 'CONSENTED', 'EXCEPTION_REVIEWED', 'UNKNOWN']).optional(),
  attested: z.boolean().optional(), commercialAllowed: z.boolean().optional(),
  allowedPlatforms: z.array(destination).max(3).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(), attributionRequired: z.boolean().optional(),
}).strict();
export const takedownSchema = z.object({ postId: id, reason: normalText(500) }).strict();
export const memberSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(['ADMIN', 'EDITOR', 'REVIEWER', 'VIEWER']) }).strict();
export const paginationSchema = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), q: z.string().trim().max(200).optional() }).strict();
export const eligibilitySchema = z.object({ platform: destination.default('YOUTUBE') }).strict();
export const publicationSchema = z.object({ videoId: id, targets: z.array(z.object({ socialAccountId: id, scheduledAt: z.string().datetime({ offset: true }), privacy: z.enum(['public', 'private', 'unlisted']) }).strict()).min(1).max(20) }).strict();
