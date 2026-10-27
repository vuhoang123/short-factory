import { z } from 'zod';

export const roleSchema = z.enum(['OWNER', 'ADMIN', 'EDITOR', 'REVIEWER', 'VIEWER']);
export type Role = z.infer<typeof roleSchema>;
export const userSchema = z.object({ id: z.string(), email: z.string(), name: z.string().nullable().optional() });
export const sessionSchema = z.object({
  user: userSchema,
  workspaces: z.array(z.object({ id: z.string(), name: z.string(), role: roleSchema })),
  activeWorkspaceId: z.string().nullable(),
});
export type Session = z.infer<typeof sessionSchema>;
export const rightsSchema = z.object({
  id: z.string(), basis: z.string(), reviewStatus: z.string(), attested: z.boolean(),
  evidence: z.string().nullable().optional(), commercialAllowed: z.boolean(),
  allowedPlatforms: z.array(z.string()), territory: z.string(),
  attributionRequired: z.boolean(), attributionText: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(), revokedAt: z.string().nullable().optional(),
});
export type ContentRight = z.infer<typeof rightsSchema>;
export const postSchema = z.object({
  id: z.string(), title: z.string().nullable(), body: z.string(), canonicalUrl: z.string().url(),
  platform: z.string(), externalPostId: z.string(), discoveredAt: z.string(),
  rights: z.array(rightsSchema), sensitiveFlags: z.array(z.string()).optional(), topicTags: z.array(z.string()).optional(), synthetic: z.boolean().optional(),
  comments: z.array(z.object({ id: z.string(), externalId: z.string(), body: z.string(), sensitiveFlags: z.array(z.string()).optional() })).optional(),
  metricSnapshots: z.array(z.object({ likes: z.number().nullable(), replies: z.number().nullable(), shares: z.number().nullable(), views: z.number().nullable(), measuredAt: z.string() })).optional(),
  source: z.object({ sourceKey: z.string(), platform: z.string() }).nullable().optional(),
  _count: z.object({ comments: z.number() }).optional(),
});
export type Post = z.infer<typeof postSchema>;
export const channelSchema = z.object({ id: z.string(), name: z.string(), language: z.string(), minimumCandidateScore: z.number().optional(), topicConfig: z.unknown().optional() });
export const sourceConfigSchema = z.object({ mode: z.enum(['USER_SUPPLIED', 'MOCK_FIXTURE']).optional(), keywords: z.array(z.string()).optional(), hashtags: z.array(z.string()).optional(), topics: z.array(z.string()).optional(), language: z.string().optional(), retainRawPayload: z.boolean().optional() }).passthrough();
export const sourceSchema = z.object({
  id: z.string(), platform: z.string(), sourceKey: z.string(), enabled: z.boolean(),
  config: sourceConfigSchema.optional(), channelId: z.string().nullable().optional(), channel: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  capabilityStatus: z.string(), syncFrequencyMinutes: z.number().optional(), lastSyncStatus: z.string().optional(), lastErrorCode: z.string().nullable().optional(),
  nextSyncAt: z.string().nullable().optional(), lastSyncAt: z.string().nullable().optional(), runs: z.array(z.object({ id: z.string(), status: z.string(), fetchedCount: z.number(), duplicateCount: z.number(), errorCode: z.string().nullable(), startedAt: z.string(), finishedAt: z.string().nullable() })).optional(),
});
export type Source = z.infer<typeof sourceSchema>;
export const commentSchema = z.object({ id: z.string(), externalId: z.string(), body: z.string() });
export const auditSchema = z.object({ id: z.string(), action: z.string(), resourceType: z.string(), resourceId: z.string(), occurredAt: z.string() });
export const dashboardSchema = z.object({
  blockers: z.array(z.object({ code: z.string(), message: z.string() })),
  phase: z.literal('PHASE_3'),
  counts: z.object({ posts: z.number(), comments: z.number(), channels: z.number(), sources: z.number(), pendingRights: z.number(), blockedRights: z.number(), candidates: z.number(), pendingSources: z.number() }),
  integrations: z.object({ sources: z.string(), media: z.string(), publishing: z.string(), tiktok: z.string() }),
});
export const eligibilitySchema = z.object({ allowed: z.boolean(), reasons: z.array(z.string()) });
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable().optional() });
}
export const unknownResponseSchema = z.unknown();
export const candidateSchema = z.object({
  id: z.string(), score: z.number().nullable(), status: z.string(), minimumScore: z.number(), modelVersion: z.string().nullable(), reasoning: z.string().nullable(),
  factors: z.object({ score: z.number(), factors: z.object({ engagementVelocity: z.number().nullable(), hookCuriosity: z.number(), commentQuality: z.number().nullable(), topicRelevance: z.number().nullable(), shortVideoSuitability: z.number() }), matchedTopics: z.array(z.string()), modelVersion: z.string(), reasoning: z.string() }).nullable(),
  eligibility: z.unknown().nullable(), post: postSchema,
});
export const topicRuleSchema = z.object({ id: z.string(), workspaceId: z.string(), channelId: z.string(), name: z.string(), keywords: z.array(z.string()), hashtags: z.array(z.string()), topics: z.array(z.string()), language: z.string().nullable(), allow: z.array(z.string()), deny: z.array(z.string()), minimumScore: z.number(), enabled: z.boolean() });
export const syncRunSchema = z.object({ id: z.string(), status: z.string(), fetchedCount: z.number(), duplicateCount: z.number(), errorCode: z.string().nullable(), startedAt: z.string(), finishedAt: z.string().nullable() });

export function mayEdit(role: Role | undefined) { return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR'; }
export function mayAdmin(role: Role | undefined) { return role === 'OWNER' || role === 'ADMIN'; }
export function mayReview(role: Role | undefined) { return role === 'OWNER' || role === 'ADMIN' || role === 'REVIEWER'; }
