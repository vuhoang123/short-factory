import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Prisma, type ContentRight, type PrismaClient } from '@shorts-factory/database';
import { LocalObjectStore, assertGroundedScript, listVoiceProfiles, prepareBackgroundImage, productionInputSchema, storyScriptSchema, type ProductionInput, type ScriptSource } from '@shorts-factory/media';
import { AuthService, adminRoles, editRoles, reviewRoles, type AuthContext } from './auth/auth.service.js';
import { ApiError, notFound } from './errors.js';
import { mutationIdentity } from './idempotency.js';
import { audioRequestSchema, backgroundUploadSchema, editStorySchema, productionCreateSchema, regenerateStorySchema, renderRequestSchema, videoReviewSchema } from './production.validation.js';

function objectStore() { return new LocalObjectStore(path.resolve(process.env.STORAGE_LOCAL_ROOT ?? '.data/objects')); }
function safePlatform(platform: string): ScriptSource['platform'] {
  if (platform === 'MANUAL' || platform === 'REDDIT' || platform === 'THREADS' || platform === 'FACEBOOK') return platform;
  throw new ApiError(409, 'SOURCE_PLATFORM_UNSUPPORTED', 'This source type cannot be produced as a short video.');
}
function assertRights(rights: ContentRight | undefined): asserts rights is ContentRight {
  if (!rights || rights.reviewStatus !== 'APPROVED' || !rights.attested || !rights.commercialAllowed || rights.revokedAt || (rights.expiresAt && rights.expiresAt.getTime() <= Date.now()) || rights.allowedPlatforms.length === 0 || (rights.attributionRequired && !rights.attributionText?.trim())) {
    throw new ApiError(409, 'BLOCKED_RIGHTS', 'Production is blocked until rights are reviewed, current, and permit video reuse.');
  }
}
function assertSafeText(post: { deletedAt: Date | null; sensitiveFlags: string[] }, comments: Array<{ sensitiveFlags: string[] }>) {
  if (post.deletedAt || post.sensitiveFlags.length || comments.some((comment) => comment.sensitiveFlags.length)) throw new ApiError(409, 'BLOCKED_SAFETY', 'Production is blocked while source safety flags or a takedown are unresolved.');
}
function validBackgroundRights(asset: { rightsMetadata: Prisma.JsonValue | null }): boolean {
  const value = asset.rightsMetadata;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, Prisma.JsonValue>;
  const expiresAt = typeof record.expiresAt === 'string' ? Date.parse(record.expiresAt) : null;
  return record.approved === true && record.attested === true && ['OWNED', 'LICENSED', 'CONSENTED'].includes(String(record.basis)) && (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > Date.now()));
}

export class ProductionService {
  constructor(readonly db: PrismaClient, readonly auth: AuthService) {}

  async voiceProfiles(request: Request) {
    await this.auth.context(request);
    return { items: listVoiceProfiles().filter((profile) => !profile.requiresCredentials || Boolean(process.env.OPENAI_API_KEY)) };
  }

  async templates(request: Request) {
    await this.auth.context(request);
    return { items: [
      { id: 'RedditStory', version: 1, name: 'Reddit Story', description: 'A source post and sequential comment cards over a vertical background.', status: 'READY' },
      { id: 'SocialCommentary', version: 1, name: 'Social Commentary', description: 'A post, narrated context, selected comments and an audience question.', status: 'READY' },
    ] };
  }

  async backgrounds(request: Request) {
    const context = await this.auth.context(request);
    const items = await this.db.mediaAsset.findMany({ where: { workspaceId: context.workspaceId, kind: 'BACKGROUND' }, select: { id: true, checksum: true, mimeType: true, metadata: true, rightsMetadata: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { items: items.filter(validBackgroundRights).map((asset) => ({ id: asset.id, mimeType: asset.mimeType, metadata: asset.metadata, rights: asset.rightsMetadata, createdAt: asset.createdAt, url: `/api/v1/media/${asset.id}` })) };
  }

  async uploadBackground(request: Request, rawBytes: unknown) {
    const context = await this.auth.context(request, editRoles);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(request.header('content-type')?.split(';')[0]?.trim() ?? '')) throw new ApiError(400, 'BACKGROUND_FORMAT_INVALID', 'Upload a PNG, JPEG, or WebP background image.');
    if (!Buffer.isBuffer(rawBytes)) throw new ApiError(400, 'BACKGROUND_FILE_REQUIRED', 'Upload a background image as the request body.');
    const headers = backgroundUploadSchema.parse({ name: request.header('x-asset-name'), basis: request.header('x-rights-basis'), attested: request.header('x-rights-attested'), evidence: request.header('x-rights-evidence') || undefined });
    const prepared = await prepareBackgroundImage(rawBytes);
    const object = await objectStore().put(context.workspaceId, prepared.bytes);
    const requestInput = { checksum: object.checksum, size: object.size, name: headers.name, basis: headers.basis, evidence: headers.evidence ?? null };
    return this.mutation(request, context, '/backgrounds', requestInput, async (tx) => {
      const existing = await tx.mediaAsset.findFirst({ where: { workspaceId: context.workspaceId, kind: 'BACKGROUND', checksum: object.checksum }, select: { id: true } });
      const asset = existing ? { id: existing.id } : await tx.mediaAsset.create({ data: {
        workspaceId: context.workspaceId, kind: 'BACKGROUND', storageKey: object.storageKey, checksum: object.checksum, mimeType: prepared.mimeType,
        metadata: { name: headers.name, width: prepared.width, height: prepared.height, sizeBytes: object.size, sourceFormat: prepared.sourceFormat ?? null },
        rightsMetadata: { basis: headers.basis, attested: true, evidence: headers.evidence ?? null, approved: true, commercialAllowed: true, uploadedById: context.userId },
      }, select: { id: true } });
      await this.audit(tx, context, 'BACKGROUND_UPLOADED', 'MediaAsset', asset.id, { checksum: object.checksum, basis: headers.basis });
      return { id: asset.id, mimeType: prepared.mimeType, width: prepared.width, height: prepared.height, sizeBytes: object.size, url: `/api/v1/media/${asset.id}` };
    });
  }

  async createFromCandidate(request: Request, candidateId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = productionCreateSchema.parse(raw);
    const profile = listVoiceProfiles().find((item) => item.id === input.voiceProfileId);
    if (!profile) throw new ApiError(400, 'VOICE_PROFILE_INVALID', 'Choose an available voice profile.');
    if (profile.language !== 'multilingual' && profile.language.toLowerCase() !== input.language.slice(0, 2).toLowerCase()) throw new ApiError(400, 'VOICE_LANGUAGE_MISMATCH', 'Choose a voice profile that supports the selected language.');
    const candidate = await this.db.contentCandidate.findFirst({ where: { id: candidateId, workspaceId: context.workspaceId }, include: { post: { include: { comments: true, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } } } });
    if (!candidate) return notFound();
    if (candidate.status !== 'APPROVED') throw new ApiError(409, 'CANDIDATE_NOT_APPROVED', 'Approve the candidate after rights and safety review before production.');
    assertRights(candidate.post.rights[0]);
    assertSafeText(candidate.post, candidate.post.comments);
    const commentsById = new Map(candidate.post.comments.map((comment) => [comment.id, comment]));
    const selected = input.commentIds.map((id) => {
      const comment = commentsById.get(id);
      if (!comment) throw new ApiError(400, 'COMMENT_NOT_IN_SOURCE', 'Select comments that belong to this source post.');
      return comment;
    });
    assertSafeText(candidate.post, selected);
    const channel = await this.db.contentChannel.findFirst({ where: { id: input.channelId, workspaceId: context.workspaceId }, select: { id: true } });
    if (!channel) return notFound();
    const normalized = await this.buildInput(context.workspaceId, {
      mode: 'CREATE', candidateId, channelId: input.channelId, commentIds: input.commentIds,
      language: input.language, targetDurationSec: input.targetDurationSec, style: input.style, voiceProfileId: profile.id, voiceId: profile.voiceId,
      speakingRate: input.speakingRate, templateId: input.templateId, backgroundAssetId: input.backgroundAssetId ?? null,
      subtitlePreset: input.subtitlePreset, theme: input.theme, anonymizeAuthors: input.anonymizeAuthors, showEngagement: input.showEngagement,
      selectedSegmentIds: [], storyVersionId: null,
    });
    return this.mutation(request, context, `/candidates/${candidateId}/produce`, input, async (tx) => {
      const current = await tx.contentCandidate.findFirst({ where: { id: candidateId, workspaceId: context.workspaceId }, include: { post: { include: { rights: { orderBy: { createdAt: 'desc' }, take: 1 }, comments: true } } } });
      if (!current) return notFound();
      if (current.status !== 'APPROVED') throw new ApiError(409, 'CANDIDATE_NOT_APPROVED', 'The candidate status changed. Reload before production.');
      assertRights(current.post.rights[0]);
      assertSafeText(current.post, current.post.comments);
      const story = await tx.storyProject.findFirst({ where: { workspaceId: context.workspaceId, sourcePostId: current.post.id, channelId: input.channelId } })
        ?? await tx.storyProject.create({ data: { workspaceId: context.workspaceId, sourcePostId: current.post.id, channelId: input.channelId, status: 'DRAFT' } });
      return this.enqueue(tx, context, story.id, normalized, `/candidates/${candidateId}/produce`);
    });
  }

  async story(request: Request, storyId: string) {
    const context = await this.auth.context(request);
    const story = await this.db.storyProject.findFirst({ where: { id: storyId, workspaceId: context.workspaceId }, include: {
      channel: { select: { id: true, name: true, language: true } },
      post: { select: { id: true, platform: true, title: true, body: true, authorAlias: true, canonicalUrl: true, comments: { select: { id: true, externalId: true, body: true, likes: true, sensitiveFlags: true } }, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      versions: { orderBy: { version: 'desc' }, take: 20, include: { audioAssets: { include: { mediaAsset: { select: { id: true, mimeType: true } } } }, subtitleTracks: true } },
    } });
    if (!story) return notFound();
    return story;
  }

  async editStory(request: Request, storyId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = editStorySchema.parse(raw);
    return this.mutation(request, context, `/stories/${storyId}`, input, async (tx) => {
      const story = await tx.storyProject.findFirst({ where: { id: storyId, workspaceId: context.workspaceId }, include: { post: { include: { comments: true } }, versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!story) return notFound();
      const latest = story.versions[0];
      if (!latest || latest.version !== input.expectedVersion) throw new ApiError(409, 'SCRIPT_VERSION_CONFLICT', 'This script changed. Reload the latest version before saving.');
      const platform = safePlatform(story.post.platform);
      const source: ScriptSource = { id: story.post.id, platform, title: story.post.title, body: story.post.body, comments: story.post.comments.map((comment) => ({ id: comment.id, body: comment.body })) };
      const script = storyScriptSchema.parse({ ...input.script, version: latest.version + 1 });
      assertGroundedScript(script, source);
      const version = await tx.storyVersion.create({ data: { workspaceId: context.workspaceId, storyProjectId: story.id, version: script.version, script: script as unknown as Prisma.InputJsonObject, modelVersion: 'manual-edit' } });
      await tx.storyProject.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id: story.id } }, data: { status: 'SCRIPT_READY' } });
      await this.audit(tx, context, 'STORY_VERSION_EDITED', 'StoryVersion', version.id, { version: version.version });
      return { id: story.id, versionId: version.id, version: version.version };
    });
  }

  async regenerateStory(request: Request, storyId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const changes = regenerateStorySchema.parse(raw);
    const story = await this.db.storyProject.findFirst({ where: { id: storyId, workspaceId: context.workspaceId }, include: { post: { include: { rights: { orderBy: { createdAt: 'desc' }, take: 1 }, comments: true } }, productionRuns: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!story) return notFound();
    assertRights(story.post.rights[0]);
    assertSafeText(story.post, story.post.comments);
    const lastInput = story.productionRuns[0] ? productionInputSchema.safeParse(story.productionRuns[0].input) : null;
    if (!lastInput?.success) throw new ApiError(409, 'PRODUCTION_SETTINGS_MISSING', 'Create the first production before regenerating this story.');
    const base = lastInput.data;
    const input = productionInputSchema.parse({ ...base, mode: 'REGENERATE', storyVersionId: null, selectedSegmentIds: [], commentIds: changes.commentIds ?? base.commentIds, targetDurationSec: changes.targetDurationSec ?? base.targetDurationSec, style: changes.style ?? base.style });
    if (input.commentIds.some((id) => !story.post.comments.some((comment) => comment.id === id))) throw new ApiError(400, 'COMMENT_NOT_IN_SOURCE', 'Select comments that belong to this source post.');
    return this.mutation(request, context, `/stories/${storyId}/regenerate`, changes, async (tx) => this.enqueue(tx, context, story.id, input, `/stories/${storyId}/regenerate`));
  }

  async requestAudio(request: Request, storyId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const changes = audioRequestSchema.parse(raw);
    const story = await this.db.storyProject.findFirst({ where: { id: storyId, workspaceId: context.workspaceId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 }, productionRuns: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!story) return notFound();
    const version = story.versions[0];
    const last = story.productionRuns[0] ? productionInputSchema.safeParse(story.productionRuns[0].input) : null;
    if (!version || !last?.success) throw new ApiError(409, 'SCRIPT_REQUIRED', 'Generate or save a script before generating audio.');
    const profile = listVoiceProfiles().find((item) => item.id === (changes.voiceProfileId ?? last.data.voiceProfileId));
    if (!profile) throw new ApiError(400, 'VOICE_PROFILE_INVALID', 'Choose an available voice profile.');
    const input = productionInputSchema.parse({ ...last.data, mode: 'AUDIO_ONLY', storyVersionId: version.id, voiceProfileId: profile.id, voiceId: profile.voiceId, speakingRate: changes.speakingRate ?? last.data.speakingRate, selectedSegmentIds: changes.segmentIds ?? [] });
    return this.mutation(request, context, `/stories/${storyId}/audio`, changes, async (tx) => this.enqueue(tx, context, story.id, input, `/stories/${storyId}/audio`));
  }

  async renderVideo(request: Request, videoId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const changes = renderRequestSchema.parse(raw);
    const video = await this.db.video.findFirst({ where: { id: videoId, workspaceId: context.workspaceId }, include: { story: { include: { post: { include: { rights: { orderBy: { createdAt: 'desc' }, take: 1 }, comments: true } }, versions: { orderBy: { version: 'desc' }, take: 1 }, productionRuns: { orderBy: { createdAt: 'desc' }, take: 1 } } } } });
    if (!video?.story) return notFound();
    assertRights(video.story.post.rights[0]);
    assertSafeText(video.story.post, video.story.post.comments);
    const latest = video.story.versions[0];
    const prior = video.story.productionRuns[0] ? productionInputSchema.safeParse(video.story.productionRuns[0].input) : null;
    if (!latest || !prior?.success) throw new ApiError(409, 'SCRIPT_REQUIRED', 'Save a script before rendering a video.');
    const backgroundAssetId = changes.backgroundAssetId === undefined ? prior.data.backgroundAssetId : changes.backgroundAssetId;
    const input = productionInputSchema.parse({ ...prior.data, mode: 'RENDER', storyVersionId: latest.id, selectedSegmentIds: [], templateId: changes.templateId ?? prior.data.templateId, backgroundAssetId, subtitlePreset: changes.subtitlePreset ?? prior.data.subtitlePreset, theme: changes.theme ?? prior.data.theme, anonymizeAuthors: changes.anonymizeAuthors ?? prior.data.anonymizeAuthors, showEngagement: changes.showEngagement ?? prior.data.showEngagement });
    await this.assertBackground(context.workspaceId, input.backgroundAssetId);
    return this.mutation(request, context, `/videos/${videoId}/render`, changes, async (tx) => this.enqueue(tx, context, video.story?.id ?? '', input, `/videos/${videoId}/render`));
  }

  async productionRun(request: Request, runId: string) {
    const context = await this.auth.context(request);
    const run = await this.db.productionRun.findFirst({ where: { id: runId, workspaceId: context.workspaceId }, include: {
      stages: { orderBy: { id: 'asc' } }, renderJob: true,
      videos: { orderBy: { createdAt: 'desc' }, take: 1, include: { mediaAsset: { select: { id: true, mimeType: true, checksum: true, metadata: true } } } },
      story: { select: { id: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true } } } },
    } });
    if (!run) return notFound();
    return run;
  }

  async videos(request: Request) {
    const context = await this.auth.context(request);
    return { items: await this.db.video.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: 'desc' }, take: 50, include: { mediaAsset: { select: { id: true, mimeType: true, checksum: true, metadata: true } }, channel: { select: { id: true, name: true } }, renderJob: true } }) };
  }

  async video(request: Request, videoId: string) {
    const context = await this.auth.context(request);
    const video = await this.db.video.findFirst({ where: { id: videoId, workspaceId: context.workspaceId }, include: { mediaAsset: true, channel: { select: { id: true, name: true } }, story: { include: { post: { select: { id: true, platform: true, title: true, body: true, authorAlias: true, comments: { select: { id: true, body: true } } } }, versions: { orderBy: { version: 'desc' }, take: 1, include: { audioAssets: { include: { mediaAsset: { select: { id: true, mimeType: true } } } }, subtitleTracks: true } } } }, renderJob: true } });
    if (!video) return notFound();
    return video;
  }

  async reviewVideo(request: Request, videoId: string, raw: unknown) {
    const context = await this.auth.context(request, reviewRoles);
    const input = videoReviewSchema.parse(raw);
    return this.mutation(request, context, `/videos/${videoId}/reviews`, input, async (tx) => {
      const video = await tx.video.findFirst({ where: { id: videoId, workspaceId: context.workspaceId }, include: {
        mediaAsset: true,
        qualityReports: { orderBy: { createdAt: 'desc' }, take: 1 },
        story: { include: { post: { include: { comments: true, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } } } },
      } });
      if (!video) return notFound();
      if (video.status !== 'READY_FOR_REVIEW' || video.reviewStatus !== 'PENDING' || video.mediaAsset?.kind !== 'VIDEO' || video.mediaAsset.mimeType !== 'video/mp4') {
        throw new ApiError(409, 'VIDEO_NOT_REVIEWABLE', 'Only a completed video awaiting review can receive a decision.');
      }
      if (input.decision === 'APPROVED') {
        if (video.qualityReports[0]?.status === 'BLOCKED') throw new ApiError(409, 'VIDEO_QUALITY_BLOCKED', 'Resolve the mandatory quality failures before approving this video.');
        if (!video.story) throw new ApiError(409, 'VIDEO_SOURCE_MISSING', 'The video source is unavailable for review.');
        assertRights(video.story.post.rights[0]);
        assertSafeText(video.story.post, video.story.post.comments);
      }
      await tx.video.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id: video.id } }, data: { status: input.decision, reviewStatus: input.decision } });
      await this.audit(tx, context, 'VIDEO_REVIEW_DECIDED', 'Video', video.id, { decision: input.decision });
      return { videoId: video.id, status: input.decision, reviewStatus: input.decision };
    });
  }

  async retryRun(request: Request, runId: string) {
    const context = await this.auth.context(request, adminRoles);
    return this.mutation(request, context, `/production-runs/${runId}/retry`, {}, async (tx) => {
      const run = await tx.productionRun.findFirst({ where: { id: runId, workspaceId: context.workspaceId }, include: { renderJob: true } });
      if (!run) return notFound();
      if (!['FAILED_RETRYABLE', 'FAILED_PERMANENT'].includes(run.status)) throw new ApiError(409, 'RUN_NOT_RETRYABLE', 'Only failed production runs can be retried.');
      const event = await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, eventType: 'PRODUCTION_RUN_REQUESTED', aggregateId: run.id, payload: { entityId: run.id, workspaceId: context.workspaceId, version: run.attempts + 1 } } });
      await tx.productionRun.update({ where: { workspaceId_id: { workspaceId: context.workspaceId, id: run.id } }, data: { status: 'QUEUED', errorCode: null, completedAt: null } });
      if (run.renderJob) await tx.renderJob.update({ where: { id: run.renderJob.id }, data: { status: 'QUEUED', progress: 0, errorCode: null, completedAt: null } });
      await this.audit(tx, context, 'PRODUCTION_RETRY_REQUESTED', 'ProductionRun', run.id);
      return { runId: run.id, status: 'QUEUED', outboxEventId: event.id };
    });
  }

  async sendAsset(request: Request, assetId: string, response: Response, download = false) {
    const context = await this.auth.context(request);
    const asset = await this.db.mediaAsset.findFirst({ where: { id: assetId, workspaceId: context.workspaceId }, select: { id: true, kind: true, checksum: true, mimeType: true, metadata: true, rightsMetadata: true } });
    if (!asset) return notFound();
    if (asset.kind === 'BACKGROUND' && !validBackgroundRights(asset)) return notFound();
    if (asset.kind === 'VIDEO') {
      const videos = await this.db.video.findMany({
        where: { workspaceId: context.workspaceId, mediaAssetId: asset.id },
        include: {
          story: {
            include: {
              post: { include: { comments: { select: { sensitiveFlags: true } }, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } },
            },
          },
        },
      });
      const accessible = videos.some((video) => {
        if (!video.story || video.status === 'BLOCKED_RIGHTS' || video.reviewStatus === 'BLOCKED') return false;
        try { assertRights(video.story.post.rights[0]); assertSafeText(video.story.post, video.story.post.comments); return true; } catch { return false; }
      });
      if (!accessible) return notFound();
    } else if (asset.kind === 'AUDIO') {
      const audioRows = await this.db.audioAsset.findMany({
        where: { workspaceId: context.workspaceId, mediaAssetId: asset.id },
        include: {
          storyVersion: {
            include: {
              story: {
                include: {
                  post: { include: { comments: { select: { sensitiveFlags: true } }, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } },
                },
              },
            },
          },
        },
      });
      const accessible = audioRows.some((audio) => {
        try { assertRights(audio.storyVersion.story.post.rights[0]); assertSafeText(audio.storyVersion.story.post, audio.storyVersion.story.post.comments); return true; } catch { return false; }
      });
      if (!accessible) return notFound();
    } else if (asset.kind !== 'BACKGROUND') return notFound();
    const bytes = await objectStore().get(context.workspaceId, asset.checksum);
    const safeName = asset.kind === 'VIDEO' ? 'short-video.mp4' : asset.kind === 'BACKGROUND' ? 'background.webp' : asset.kind === 'AUDIO' ? 'narration.wav' : 'media.bin';
    response.status(200);
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', bytes.byteLength);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${safeName}"`);
    response.end(bytes);
  }

  private async assertBackground(workspaceId: string, id: string | null) {
    if (!id) return;
    const asset = await this.db.mediaAsset.findFirst({ where: { id, workspaceId, kind: 'BACKGROUND' }, select: { rightsMetadata: true } });
    if (!asset || !validBackgroundRights(asset)) throw new ApiError(409, 'BACKGROUND_RIGHTS_INVALID', 'Choose a workspace background with verified usage rights.');
  }

  private async buildInput(workspaceId: string, raw: unknown): Promise<ProductionInput> {
    const input = productionInputSchema.parse(raw);
    await this.assertBackground(workspaceId, input.backgroundAssetId);
    return input;
  }

  private async mutation(request: Request, context: AuthContext, route: string, input: unknown, work: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonObject>) {
    const { key, requestHash } = mutationIdentity(request, input);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: context.userId } } });
          if (!member || member.role !== context.role) throw new ApiError(403, 'FORBIDDEN', 'Your workspace permissions changed. Retry the request.');
          const old = await tx.idempotencyRecord.findUnique({ where: { workspaceId_userId_route_key: { workspaceId: context.workspaceId, userId: context.userId, route, key } } });
          if (old) {
            if (old.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
            return old.response;
          }
          const response = await work(tx);
          await tx.idempotencyRecord.create({ data: { workspaceId: context.workspaceId, userId: context.userId, route, key, requestHash, response, statusCode: 202 } });
          return response;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) continue;
        throw error;
      }
    }
    throw new ApiError(409, 'CONCURRENT_CHANGE', 'The resource changed. Please retry.');
  }

  private async enqueue(tx: Prisma.TransactionClient, context: AuthContext, storyProjectId: string, input: ProductionInput, route: string) {
    const run = await tx.productionRun.create({ data: {
      workspaceId: context.workspaceId, storyProjectId, requestedById: context.userId, idempotencyKey: `${route}:${randomKey()}`,
      status: 'QUEUED', currentStage: input.mode === 'CREATE' || input.mode === 'REGENERATE' ? 'SCRIPT_GENERATION' : 'TTS_GENERATION', input: input as unknown as Prisma.InputJsonObject,
    } });
    const renderJob = await tx.renderJob.create({ data: { workspaceId: context.workspaceId, productionRunId: run.id, status: 'QUEUED' } });
    const event = await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, eventType: 'PRODUCTION_RUN_REQUESTED', aggregateId: run.id, payload: { entityId: run.id, workspaceId: context.workspaceId, version: 1 } } });
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.userId, action: 'PRODUCTION_REQUESTED', resourceType: 'ProductionRun', resourceId: run.id, metadata: { storyProjectId, mode: input.mode } } });
    return { runId: run.id, storyProjectId, renderJobId: renderJob.id, outboxEventId: event.id, status: 'QUEUED' };
  }

  private async audit(tx: Prisma.TransactionClient, context: AuthContext, action: string, resourceType: string, resourceId: string, metadata?: Prisma.InputJsonObject) {
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.userId, action, resourceType, resourceId, ...(metadata ? { metadata } : {}) } });
  }
}

function randomKey(): string { return randomUUID(); }
