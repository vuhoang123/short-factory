import type { Request } from 'express';
import { Prisma, type PrismaClient } from '@shorts-factory/database';
import { z } from 'zod';
import { AuthService } from './auth/auth.service.js';
import { notFound } from './errors.js';
import { contentLifecycle } from './studio.lifecycle.js';

export const studioQuerySchema = z.object({
  cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(24).default(12),
  q: z.string().trim().max(200).optional(), platform: z.enum(['MANUAL', 'REDDIT', 'THREADS', 'FACEBOOK']).optional(),
  topic: z.string().trim().max(80).optional(), minScore: z.coerce.number().min(0).max(100).optional(),
  minLikes: z.coerce.number().int().min(0).max(2147483647).optional(),
  from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
}).strict().refine((q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to), 'The start date must precede the end date.');

const postSelect = {
  id: true, platform: true, externalPostId: true, canonicalUrl: true, title: true, body: true, topicTags: true,
  discoveredAt: true, publishedAt: true, synthetic: true, sensitiveFlags: true,
  channel: { select: { id: true, name: true, language: true, minimumCandidateScore: true } },
  rights: { orderBy: { createdAt: 'desc' }, take: 1 },
  comments: { orderBy: { publishedAt: 'desc' }, take: 100, select: { id: true, externalId: true, body: true, sensitiveFlags: true } },
  metricSnapshots: { orderBy: { measuredAt: 'desc' }, take: 1, select: { likes: true, replies: true, shares: true, views: true, measuredAt: true } },
  candidates: { take: 1, select: { id: true, status: true, score: true, minimumScore: true, reasoning: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.SourcePostSelect;

export class StudioService {
  constructor(private readonly db: PrismaClient, private readonly auth: AuthService) {}

  async items(request: Request, raw: unknown, postId?: string) {
    const { workspaceId } = await this.auth.context(request);
    const input = studioQuerySchema.parse(raw);
    if (input.cursor && !await this.db.sourcePost.findFirst({ where: { id: input.cursor, workspaceId, deletedAt: null }, select: { id: true } })) return notFound();
    const posts = await this.db.sourcePost.findMany({
      where: { workspaceId, deletedAt: null, ...(postId ? { id: postId } : {}),
        ...(input.q ? { OR: [{ title: { contains: input.q, mode: 'insensitive' } }, { body: { contains: input.q, mode: 'insensitive' } }] } : {}),
        ...(input.platform ? { platform: input.platform } : {}), ...(input.topic ? { topicTags: { has: input.topic } } : {}),
        ...(input.minScore !== undefined ? { candidates: { some: { score: { gte: input.minScore } } } } : {}),
        ...(input.minLikes !== undefined ? { metricSnapshots: { some: { likes: { gte: input.minLikes } } } } : {}),
        ...(input.from || input.to ? { discoveredAt: { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lte: new Date(input.to) } : {}) } } : {}),
      }, select: postSelect, take: postId ? 1 : input.limit + 1,
      orderBy: [{ discoveredAt: 'desc' }, { id: 'desc' }], ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    if (postId && !posts.length) return notFound();
    const page = posts.slice(0, input.limit);
    const ids = page.map((post) => post.id);
    const latest = ids.length ? await this.db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT ON (s."sourcePostId") r.id FROM "ProductionRun" r
      JOIN "StoryProject" s ON s.id = r."storyProjectId" AND s."workspaceId" = r."workspaceId"
      WHERE r."workspaceId" = ${workspaceId} AND s."sourcePostId" IN (${Prisma.join(ids)})
      ORDER BY s."sourcePostId", r."createdAt" DESC, r.id DESC
    `) : [];
    const runs = latest.length ? await this.db.productionRun.findMany({ where: { workspaceId, id: { in: latest.map((row) => row.id) } }, select: {
      id: true, storyProjectId: true, status: true, currentStage: true, errorCode: true, createdAt: true,
      story: { select: { sourcePostId: true } }, renderJob: { select: { progress: true } },
      videos: { where: { status: { not: 'CANCELLED' } }, take: 1, orderBy: { createdAt: 'desc' }, select: {
        id: true, title: true, reviewStatus: true, mediaAsset: { select: { id: true } },
        publications: { take: 1, orderBy: { createdAt: 'desc' }, select: { status: true, remotePostId: true } },
      } },
    } }) : [];
    const byPost = new Map(runs.map((run) => [run.story.sourcePostId, run]));
    return { items: page.map((post) => {
      const candidate = post.candidates[0] ?? null;
      const run = byPost.get(post.id);
      const video = run?.videos[0];
      const right = post.rights[0];
      const currentRights = right && !right.revokedAt && (!right.expiresAt || right.expiresAt > new Date()) && right.basis !== 'UNKNOWN' && right.attested && right.commercialAllowed && right.allowedPlatforms.length > 0 && (!right.attributionRequired || Boolean(right.attributionText?.trim()));
      return { id: post.id, post: { ...post, body: postId ? post.body : post.body.slice(0, 600), comments: postId ? post.comments : post.comments.slice(0, 3), candidates: undefined }, candidate,
        run: run ? { id: run.id, storyProjectId: run.storyProjectId, status: run.status, currentStage: run.currentStage, errorCode: run.errorCode, progress: run.renderJob?.progress ?? 0 } : null,
        video: video ? { id: video.id, title: video.title, reviewStatus: video.reviewStatus, assetId: video.mediaAsset?.id ?? null } : null,
        lifecycle: contentLifecycle({ candidateStatus: candidate?.status, score: candidate?.score, minimumScore: candidate?.minimumScore, rightsStatus: currentRights ? right?.reviewStatus : undefined,
          unsafe: Boolean(candidate?.status === 'BLOCKED_SAFETY' || post.sensitiveFlags.length || post.comments.some((comment) => comment.sensitiveFlags.length)), run,
          video: video ? { reviewStatus: video.reviewStatus, publication: video.publications[0] } : null }),
      };
    }), nextCursor: posts.length > input.limit ? page.at(-1)?.id ?? null : null };
  }

  async overview(request: Request) {
    const { workspaceId } = await this.auth.context(request);
    const [discovered, selected, scripting, rendering, review, approved, failed, scheduled, published, recent] = await Promise.all([
      this.db.sourcePost.count({ where: { workspaceId, deletedAt: null } }),
      this.db.contentCandidate.count({ where: { workspaceId, status: 'APPROVED', post: { deletedAt: null } } }),
      this.db.productionRun.count({ where: { workspaceId, status: { in: ['QUEUED', 'RUNNING'] }, OR: [{ currentStage: null }, { currentStage: { notIn: ['VIDEO_RENDER', 'MEDIA_VALIDATION', 'STORAGE_UPLOAD'] } }] } }),
      this.db.productionRun.count({ where: { workspaceId, status: { in: ['QUEUED', 'RUNNING'] }, currentStage: { in: ['VIDEO_RENDER', 'MEDIA_VALIDATION', 'STORAGE_UPLOAD'] } } }),
      this.db.video.count({ where: { workspaceId, reviewStatus: 'PENDING', status: 'READY_FOR_REVIEW' } }),
      this.db.video.count({ where: { workspaceId, reviewStatus: 'APPROVED' } }),
      this.db.productionRun.count({ where: { workspaceId, status: { in: ['FAILED_RETRYABLE', 'FAILED_PERMANENT', 'BLOCKED_RIGHTS', 'BLOCKED_EXTERNAL'] } } }),
      this.db.publication.count({ where: { workspaceId, status: { in: ['SCHEDULED', 'QUEUED', 'UPLOADING', 'PROCESSING'] } } }),
      this.db.publication.count({ where: { workspaceId, status: 'PUBLISHED', remotePostId: { not: { startsWith: 'mock:' } } } }),
      this.db.productionRun.findMany({ where: { workspaceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 8, select: { id: true, status: true, currentStage: true, errorCode: true, createdAt: true, story: { select: { sourcePostId: true, post: { select: { title: true } } } }, videos: { take: 1, orderBy: { createdAt: 'desc' }, select: { id: true, reviewStatus: true, mediaAsset: { select: { id: true } } } } } }),
    ]);
    return { counts: { discovered, selected, scripting, rendering, review, approved, failed, scheduled, published }, recent, publishing: 'BLOCKED_EXTERNAL' };
  }
}
