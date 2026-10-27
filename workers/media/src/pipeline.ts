import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, PrismaClient, type ContentRight, type ProductionRun, type StoryProject, type StoryVersion } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import { LocalObjectStore, assertGroundedScript, audioCacheKey, createRenderManifest, createScriptProvider, createTtsProvider, generateSubtitleTrack, listVoiceProfiles, productionInputSchema, renderVideo, storyScriptSchema, type CompositionInput, type ProductionInput, type ScriptSource, type StoryScript } from '@shorts-factory/media';
import { z } from 'zod';
import type { MediaWorkerConfig } from './config.js';
import type { MediaEnvelope } from './outbox.js';

const noopOutputSchema = z.object({ ok: z.literal(true) }).strict();
const versionOutputSchema = z.object({ versionId: z.string().uuid() }).strict();
const scriptOutputSchema = z.object({ script: storyScriptSchema, provider: z.string(), modelVersion: z.string() }).strict();
const manifestOutputSchema = z.object({ manifestId: z.string().uuid(), videoId: z.string().uuid() }).strict();
const videoOutputSchema = z.object({ videoId: z.string().uuid(), mediaAssetId: z.string().uuid() }).strict();
const alignmentOutputSchema = z.object({ timingPrecision: z.enum(['PROVIDER', 'APPROXIMATE']), segments: z.array(z.object({ segmentId: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict()) }).strict();
const assetPreparationOutputSchema = z.object({ mediaAssetIds: z.array(z.string().uuid()), ready: z.literal(true) }).strict();
const mediaValidationOutputSchema = videoOutputSchema.extend({ width: z.literal(1080), height: z.literal(1920), fps: z.literal(30), codec: z.literal('h264'), audioCodec: z.literal('aac') }).strict();
const storageUploadOutputSchema = videoOutputSchema.extend({ checksum: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive() }).strict();

type RunWithStory = ProductionRun & {
  story: StoryProject & {
    post: {
      id: string; platform: string; title: string | null; body: string; authorAlias: string | null; deletedAt: Date | null; sensitiveFlags: string[];
      comments: Array<{ id: string; body: string; sensitiveFlags: string[]; likes: number | null }>;
      rights: ContentRight[];
    };
    channel: { id: string; name: string; language: string } | null;
  };
};

function safePlatform(platform: string): ScriptSource['platform'] {
  if (platform === 'MANUAL' || platform === 'REDDIT' || platform === 'THREADS' || platform === 'FACEBOOK') return platform;
  throw new Error('SOURCE_PLATFORM_UNSUPPORTED');
}
function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message) ? error.message : 'MEDIA_PRODUCTION_FAILED';
}
function isBlocked(code: string) { return code === 'BLOCKED_RIGHTS' || code === 'BLOCKED_EXTERNAL' || code === 'PAID_PROVIDER_BUDGET_UNBOUNDED' || code === 'CANDIDATE_NOT_APPROVED'; }
function asInputJson(value: Record<string, unknown>): Prisma.InputJsonObject { return value as Prisma.InputJsonObject; }
function validBackgroundRights(value: Prisma.JsonValue | null): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rights = value as Record<string, Prisma.JsonValue>;
  const expiry = typeof rights.expiresAt === 'string' ? Date.parse(rights.expiresAt) : null;
  return rights.approved === true && rights.attested === true && ['OWNED', 'LICENSED', 'CONSENTED'].includes(String(rights.basis)) && (expiry === null || (Number.isFinite(expiry) && expiry > Date.now()));
}

export interface AutomationMediaPermission {
  parentStatus: string;
  controlStatus: string | null;
  reservationStatus: string | null;
  reservedUsd: number;
  requiredUsd: number;
  paidProvider: boolean;
}

export function assertAutomationMediaPermission(input: AutomationMediaPermission): void {
  if (!['QUEUED', 'RUNNING', 'WAITING_DISCOVERY', 'WAITING_PRODUCTION', 'WAITING_APPROVAL', 'AWAITING_APPROVAL', 'WAITING_PUBLISHING', 'WAITING_PUBLICATION'].includes(input.parentStatus) || !input.controlStatus || ['STOPPED', 'DISABLED'].includes(input.controlStatus)) throw new Error('AUTOMATION_CANCELLED');
  if (input.controlStatus !== 'ACTIVE') throw new Error('AUTOMATION_PAUSED');
  if (input.reservationStatus !== 'ACTIVE' || !Number.isFinite(input.reservedUsd) || !Number.isFinite(input.requiredUsd) || input.requiredUsd < 0 || input.reservedUsd < input.requiredUsd) throw new Error('AUTOMATION_BUDGET_RESERVATION_REQUIRED');
  if (input.paidProvider) throw new Error('PAID_PROVIDER_BUDGET_UNBOUNDED');
}

export class MediaProductionPipeline {
  private readonly store: LocalObjectStore;
  constructor(readonly db: PrismaClient, readonly config: MediaWorkerConfig) { this.store = new LocalObjectStore(path.resolve(config.STORAGE_LOCAL_ROOT)); }

  async process(raw: unknown, attemptsMade = 0, maxAttempts = this.config.MEDIA_RETRY_ATTEMPTS): Promise<void> {
    const job = jobEnvelopeSchema.parse(raw) as MediaEnvelope;
    if (job.step === 'MEDIA_ASSET_DELETE_REQUESTED') {
      const payload = await this.db.outboxEvent.findFirst({ where: { id: job.jobId, workspaceId: job.workspaceId }, select: { payload: true } });
      const deleteRequest = z.object({ entityId: z.string().uuid(), workspaceId: z.string().uuid(), storageKey: z.string().min(1), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(payload?.payload);
      if (deleteRequest.workspaceId !== job.workspaceId || deleteRequest.entityId !== job.entityId) throw new Error('MEDIA_DELETE_EVENT_INVALID');
      const referenced = await this.db.mediaAsset.findFirst({ where: { workspaceId: job.workspaceId, storageKey: deleteRequest.storageKey }, select: { id: true } });
      if (!referenced) await this.store.delete(job.workspaceId, deleteRequest.checksum);
      return;
    }
    if (job.step !== 'PRODUCTION_RUN_REQUESTED') throw new Error('UNSUPPORTED_MEDIA_EVENT');
    const run = await this.loadRun(job.workspaceId, job.entityId);
    if (!run) return;
    if (['SUCCEEDED', 'CANCELLED', 'BLOCKED_RIGHTS', 'BLOCKED_EXTERNAL'].includes(run.status)) return;
    const input = productionInputSchema.parse(run.input);
    const now = new Date();
    const active = await this.db.productionRun.updateMany({
      where: {
        id: run.id,
        workspaceId: run.workspaceId,
        OR: [
          { status: { in: ['QUEUED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT'] } },
          { status: 'RUNNING', OR: [{ workerLeaseUntil: null }, { workerLeaseUntil: { lt: now } }] },
        ],
      },
      data: { status: 'RUNNING', attempts: { increment: 1 }, workerLeaseUntil: new Date(now.getTime() + 90_000), startedAt: run.startedAt ?? now, errorCode: null },
    });
    if (!active.count) return;
    const claimedRun: RunWithStory = { ...run, status: 'RUNNING', attempts: run.attempts + 1 };
    await this.db.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date(), errorCode: null } });
    const leaseHeartbeat = setInterval(() => {
      void this.db.productionRun.updateMany({
        where: { id: claimedRun.id, workspaceId: claimedRun.workspaceId, status: 'RUNNING', attempts: claimedRun.attempts },
        data: { workerLeaseUntil: new Date(Date.now() + 90_000) },
      }).catch(() => undefined);
    }, 20_000);
    leaseHeartbeat.unref();
    try {
      await this.execute(claimedRun, input);
    } catch (error) {
      const code = errorCode(error);
      const blocked = isBlocked(code);
      const paused = code === 'AUTOMATION_PAUSED';
      const cancelled = code === 'AUTOMATION_CANCELLED';
      const terminal = !paused && attemptsMade + 1 >= maxAttempts;
      const now = new Date();
      const status = cancelled ? 'CANCELLED' : blocked ? (code === 'BLOCKED_EXTERNAL' || code === 'PAID_PROVIDER_BUDGET_UNBOUNDED' ? 'BLOCKED_EXTERNAL' : 'BLOCKED_RIGHTS') : terminal ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE';
      await this.db.$transaction(async (tx) => {
        await tx.productionRun.updateMany({ where: { id: claimedRun.id, workspaceId: claimedRun.workspaceId, status: 'RUNNING', attempts: claimedRun.attempts }, data: { status, workerLeaseUntil: null, errorCode: code, completedAt: cancelled || blocked || terminal ? now : null } });
        await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id, status: 'RUNNING', attempts: claimedRun.attempts }, data: { status, errorCode: code, completedAt: cancelled || blocked || terminal ? now : null } });
        if (cancelled) {
          const parent = await tx.workflowRun.findFirst({ where: { workspaceId: run.workspaceId, entityType: 'AUTOPILOT', output: { path: ['productionRunId'], equals: run.id } }, select: { id: true } });
          if (parent) await tx.budgetReservation.updateMany({ where: { workspaceId: run.workspaceId, workflowRunId: parent.id, status: 'CLOSING' }, data: { status: 'RELEASED' } });
        }
      });
      throw new Error(code);
    } finally {
      clearInterval(leaseHeartbeat);
      await this.db.productionRun.updateMany({ where: { id: claimedRun.id, workspaceId: claimedRun.workspaceId, attempts: claimedRun.attempts }, data: { workerLeaseUntil: null } });
    }
  }

  private async loadRun(workspaceId: string, id: string): Promise<RunWithStory | null> {
    return this.db.productionRun.findFirst({ where: { id, workspaceId }, include: {
      story: { include: { post: { include: { comments: true, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } }, channel: true } },
    } }) as Promise<RunWithStory | null>;
  }

  private async assertAutomationAction(run: RunWithStory, paidProvider: boolean) {
    const parent = await this.db.workflowRun.findFirst({ where: { workspaceId: run.workspaceId, entityType: 'AUTOPILOT', output: { path: ['productionRunId'], equals: run.id } } });
    if (!parent) return;
    const [rule, reservation] = await Promise.all([
      this.db.automationRule.findUnique({ where: { workspaceId_channelId: { workspaceId: run.workspaceId, channelId: parent.entityId } }, select: { status: true } }),
      this.db.budgetReservation.findUnique({ where: { workspaceId_workflowRunId: { workspaceId: run.workspaceId, workflowRunId: parent.id } } }),
    ]);
    const snapshot = z.object({ config: z.object({ estimatedRunCostUsd: z.number().nonnegative() }) }).parse(parent.input);
    assertAutomationMediaPermission({ parentStatus: parent.status, controlStatus: rule?.status ?? null, reservationStatus: reservation?.status ?? null, reservedUsd: Number(reservation?.amountUsd ?? 0), requiredUsd: snapshot.config.estimatedRunCostUsd, paidProvider });
  }

  private source(run: RunWithStory, input: ProductionInput): ScriptSource {
    const post = run.story.post;
    const selected = new Set(input.commentIds);
    const comments = post.comments.filter((comment) => selected.has(comment.id));
    if (comments.length !== selected.size) throw new Error('COMMENT_NOT_IN_SOURCE');
    return { id: post.id, platform: safePlatform(post.platform), title: post.title, body: post.body, comments: comments.map((comment) => ({ id: comment.id, body: comment.body })) };
  }

  private assertRights(run: RunWithStory, input: ProductionInput) {
    const rights = run.story.post.rights[0];
    if (!rights || rights.reviewStatus !== 'APPROVED' || !rights.attested || !rights.commercialAllowed || rights.revokedAt || (rights.expiresAt && rights.expiresAt.getTime() <= Date.now()) || rights.allowedPlatforms.length === 0 || (rights.attributionRequired && !rights.attributionText?.trim())) throw new Error('BLOCKED_RIGHTS');
    const post = run.story.post;
    const selectedComments = post.comments.filter((comment) => input.commentIds.includes(comment.id));
    if (post.deletedAt || post.sensitiveFlags.length || selectedComments.some((comment) => comment.sensitiveFlags.length)) throw new Error('BLOCKED_RIGHTS');
    if (input.backgroundAssetId) {
      // Background ownership/consent is rechecked here because it may change after enqueue.
      return this.assertBackground(run.workspaceId, input.backgroundAssetId);
    }
    return Promise.resolve();
  }

  private async assertRunActive(tx: Prisma.TransactionClient, run: RunWithStory, input: ProductionInput) {
    const [currentRun, post, background] = await Promise.all([
      tx.productionRun.findFirst({ where: { id: run.id, workspaceId: run.workspaceId, status: 'RUNNING', attempts: run.attempts, workerLeaseUntil: { gt: new Date() } }, select: { id: true } }),
      tx.sourcePost.findFirst({ where: { id: run.story.post.id, workspaceId: run.workspaceId, deletedAt: null }, include: { comments: true, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
      input.backgroundAssetId ? tx.mediaAsset.findFirst({ where: { id: input.backgroundAssetId, workspaceId: run.workspaceId, kind: 'BACKGROUND' }, select: { rightsMetadata: true } }) : Promise.resolve(null),
    ]);
    const parent = await tx.workflowRun.findFirst({ where: { workspaceId: run.workspaceId, entityType: 'AUTOPILOT', output: { path: ['productionRunId'], equals: run.id } } });
    if (parent) {
      const [rule, reservation] = await Promise.all([
        tx.automationRule.findUnique({ where: { workspaceId_channelId: { workspaceId: run.workspaceId, channelId: parent.entityId } }, select: { status: true } }),
        tx.budgetReservation.findUnique({ where: { workspaceId_workflowRunId: { workspaceId: run.workspaceId, workflowRunId: parent.id } } }),
      ]);
      const snapshot = z.object({ config: z.object({ estimatedRunCostUsd: z.number().nonnegative() }) }).parse(parent.input);
      assertAutomationMediaPermission({ parentStatus: parent.status, controlStatus: rule?.status ?? null, reservationStatus: reservation?.status ?? null, reservedUsd: Number(reservation?.amountUsd ?? 0), requiredUsd: snapshot.config.estimatedRunCostUsd, paidProvider: false });
    }
    const rights = post?.rights[0];
    if (!currentRun || !post || !rights || rights.reviewStatus !== 'APPROVED' || !rights.attested || !rights.commercialAllowed || rights.revokedAt || (rights.expiresAt && rights.expiresAt.getTime() <= Date.now()) || rights.allowedPlatforms.length === 0 || (rights.attributionRequired && !rights.attributionText?.trim())) throw new Error('BLOCKED_RIGHTS');
    const selected = post.comments.filter((comment) => input.commentIds.includes(comment.id));
    if (post.sensitiveFlags.length || selected.length !== input.commentIds.length || selected.some((comment) => comment.sensitiveFlags.length)) throw new Error('BLOCKED_RIGHTS');
    if (input.backgroundAssetId && (!background || !validBackgroundRights(background.rightsMetadata))) throw new Error('BLOCKED_RIGHTS');
  }

  private async assertBackground(workspaceId: string, id: string) {
    const asset = await this.db.mediaAsset.findFirst({ where: { id, workspaceId, kind: 'BACKGROUND' }, select: { rightsMetadata: true } });
    const value = asset?.rightsMetadata;
    if (!validBackgroundRights(value ?? null)) throw new Error('BLOCKED_RIGHTS');
  }

  private async execute(run: RunWithStory, input: ProductionInput) {
    await this.assertRights(run, input);
    const source = this.source(run, input);
    let version: StoryVersion;
    if (input.mode === 'CREATE' || input.mode === 'REGENERATE') version = await this.generateVersion(run, input, source);
    else version = await this.loadVersion(run.workspaceId, run.story.id, input.storyVersionId);

    const script = storyScriptSchema.parse(version.script);
    await this.stage(run, 'SCRIPT_VALIDATION', noopOutputSchema, async () => {
      assertGroundedScript(script, source);
      return { ok: true };
    });
    await this.generateAudio(run, input, version, script);
    if (input.mode === 'AUDIO_ONLY') {
      await this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        await tx.storyProject.updateMany({ where: { id: run.story.id, workspaceId: run.workspaceId }, data: { status: 'AUDIO_READY' } });
        await tx.productionRun.updateMany({ where: { id: run.id, workspaceId: run.workspaceId }, data: { status: 'SUCCEEDED', currentStage: 'AUDIO_READY', completedAt: new Date() } });
        await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { status: 'SUCCEEDED', progress: 1, completedAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    }
    await this.prepareAssets(run, input, version, script);
    const alignment = await this.alignAudio(run, input, version, script);
    await this.createSubtitles(run, input, version, script, alignment);
    const manifest = await this.createManifest(run, input, version, script);
    const rendered = await this.render(run, input, version, script, manifest);
    await this.validateMedia(run, input, rendered);
    await this.confirmStoredMedia(run, input, rendered);
    await this.stage(run, 'READY_FOR_REVIEW', noopOutputSchema, async () => {
      await this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        await tx.video.updateMany({ where: { id: rendered.videoId, workspaceId: run.workspaceId }, data: { status: 'READY_FOR_REVIEW', reviewStatus: 'PENDING' } });
        await tx.storyProject.updateMany({ where: { id: run.story.id, workspaceId: run.workspaceId }, data: { status: 'REVIEW_PENDING' } });
        await tx.productionRun.updateMany({ where: { id: run.id, workspaceId: run.workspaceId }, data: { currentStage: 'READY_FOR_REVIEW' } });
        await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { progress: 0.99 } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { ok: true };
    });
    await this.db.$transaction(async (tx) => {
      await this.assertRunActive(tx, run, input);
      await tx.productionRun.updateMany({ where: { id: run.id, workspaceId: run.workspaceId }, data: { status: 'SUCCEEDED', currentStage: 'READY_FOR_REVIEW', completedAt: new Date() } });
      await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { status: 'SUCCEEDED', progress: 1, completedAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async generateVersion(run: RunWithStory, input: ProductionInput, source: ScriptSource) {
    const generated = await this.stage(run, 'SCRIPT_GENERATION', scriptOutputSchema, async () => {
      if (input.candidateId) {
        const candidate = await this.db.contentCandidate.findFirst({ where: { id: input.candidateId, workspaceId: run.workspaceId }, select: { status: true } });
        if (candidate?.status !== 'APPROVED') throw new Error('CANDIDATE_NOT_APPROVED');
      }
      const provider = createScriptProvider();
      await this.assertAutomationAction(run, !provider.id.includes('mock'));
      const result = await provider.generate({ source, language: input.language, targetDurationSec: input.targetDurationSec, style: input.style });
      assertGroundedScript(result.script, source);
      return { script: result.script, provider: result.provider, modelVersion: result.modelVersion };
    });
    const persisted = await this.db.productionStage.findUnique({ where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name: 'SCRIPT_VERSION_PERSISTENCE' } } });
    if (persisted?.status === 'SUCCEEDED') return this.loadVersion(run.workspaceId, run.story.id, versionOutputSchema.parse(persisted.output).versionId);
    await this.startStage(run, 'SCRIPT_VERSION_PERSISTENCE');
    return this.db.$transaction(async (tx) => {
      await this.assertRunActive(tx, run, input);
      const latest = await tx.storyVersion.findFirst({ where: { workspaceId: run.workspaceId, storyProjectId: run.story.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const actualVersion = (latest?.version ?? 0) + 1;
      const finalScript = storyScriptSchema.parse({ ...generated.script, version: actualVersion });
      const row = await tx.storyVersion.create({ data: { workspaceId: run.workspaceId, storyProjectId: run.story.id, version: actualVersion, script: finalScript as unknown as Prisma.InputJsonObject, modelVersion: `${generated.provider}:${generated.modelVersion}` } });
      await tx.storyProject.updateMany({ where: { id: run.story.id, workspaceId: run.workspaceId }, data: { status: 'SCRIPT_READY' } });
      await tx.productionStage.update({ where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name: 'SCRIPT_VERSION_PERSISTENCE' } }, data: { status: 'SUCCEEDED', output: { versionId: row.id }, completedAt: new Date(), errorCode: null } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async loadVersion(workspaceId: string, storyProjectId: string, id: string | null) {
    if (!id) throw new Error('SCRIPT_VERSION_REQUIRED');
    const version = await this.db.storyVersion.findFirst({ where: { id, workspaceId, storyProjectId } });
    if (!version) throw new Error('SCRIPT_VERSION_NOT_FOUND');
    return version;
  }

  private async generateAudio(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript) {
    const selected = input.selectedSegmentIds.length ? new Set(input.selectedSegmentIds) : null;
    const segments = script.segments.filter((segment) => !selected || selected.has(segment.id));
    if (!segments.length) throw new Error('AUDIO_SEGMENTS_REQUIRED');
    const provider = createTtsProvider();
    const profile = listVoiceProfiles().find((item) => item.id === input.voiceProfileId);
    if (!profile || profile.voiceId !== input.voiceId) throw new Error('VOICE_PROFILE_INVALID');
    await this.stage(run, 'TTS_GENERATION', noopOutputSchema, async () => {
      for (const segment of segments) {
        const synthesisInput = { text: segment.text, language: script.language, voiceId: input.voiceId, speakingRate: input.speakingRate };
        const cacheKey = createHash('sha256').update(`${version.id}:${audioCacheKey(synthesisInput, provider.id)}`).digest('hex');
        const cached = await this.db.audioAsset.findFirst({ where: { workspaceId: run.workspaceId, cacheKey } });
        if (cached) continue;
        await this.assertAutomationAction(run, !provider.id.includes('mock') && !provider.id.includes('local'));
        const result = await provider.synthesize(synthesisInput);
        const object = await this.store.put(run.workspaceId, result.audio);
        await this.db.$transaction(async (tx) => {
          await this.assertRunActive(tx, run, input);
          const existing = await tx.audioAsset.findFirst({ where: { workspaceId: run.workspaceId, cacheKey } });
          if (existing) return;
          const media = await tx.mediaAsset.upsert({
            where: { workspaceId_storageKey: { workspaceId: run.workspaceId, storageKey: object.storageKey } },
            create: { workspaceId: run.workspaceId, kind: 'AUDIO', storageKey: object.storageKey, checksum: object.checksum, mimeType: result.mimeType, metadata: { provider: result.provider, voiceId: result.voiceId, durationMs: result.durationMs, timingPrecision: result.timingPrecision, usageUnits: result.usageUnits, estimatedCostUsd: result.estimatedCostUsd } },
            update: {},
          });
          await tx.audioAsset.create({ data: {
            workspaceId: run.workspaceId, storyVersionId: version.id, mediaAssetId: media.id, segmentId: segment.id, voiceProfileId: profile.id,
            provider: result.provider, cacheKey, durationMs: result.durationMs, timingPrecision: result.timingPrecision, usageUnits: result.usageUnits, estimatedCostUsd: result.estimatedCostUsd,
          } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      }
      await this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        await tx.storyProject.updateMany({ where: { id: run.story.id, workspaceId: run.workspaceId }, data: { status: 'AUDIO_READY' } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { ok: true };
    });
    const actual = await this.db.audioAsset.findMany({ where: { workspaceId: run.workspaceId, storyVersionId: version.id }, select: { segmentId: true } });
    if (input.mode !== 'AUDIO_ONLY' && script.segments.some((segment) => !actual.some((item) => item.segmentId === segment.id))) throw new Error('AUDIO_ASSET_MISSING');
    const totalSeconds = await this.db.audioAsset.aggregate({ where: { workspaceId: run.workspaceId, storyVersionId: version.id }, _sum: { durationMs: true } });
    if ((totalSeconds._sum.durationMs ?? 0) > this.config.MEDIA_MAX_RENDER_SECONDS * 1000) throw new Error('MEDIA_DURATION_EXCEEDED');
  }

  private async createSubtitles(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript, alignment: z.infer<typeof alignmentOutputSchema>) {
    await this.stage(run, 'SUBTITLE_GENERATION', noopOutputSchema, async () => {
      const timeline = alignment.segments.map((item) => {
        const segment = script.segments.find((candidate) => candidate.id === item.segmentId);
        if (!segment) throw new Error('AUDIO_ASSET_MISSING');
        return { segment, startMs: item.startMs, endMs: item.endMs };
      });
      const subtitle = generateSubtitleTrack(timeline, input.subtitlePreset);
      await this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        await tx.subtitleTrack.upsert({
          where: { workspaceId_storyVersionId_preset: { workspaceId: run.workspaceId, storyVersionId: version.id, preset: input.subtitlePreset } },
          create: { workspaceId: run.workspaceId, storyVersionId: version.id, language: script.language, preset: input.subtitlePreset, timingPrecision: alignment.timingPrecision, timeline: subtitle.timeline as unknown as Prisma.InputJsonArray, srt: subtitle.srt },
          update: { language: script.language, timingPrecision: alignment.timingPrecision, timeline: subtitle.timeline as unknown as Prisma.InputJsonArray, srt: subtitle.srt },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { ok: true };
    });
  }

  private async alignAudio(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript) {
    return this.stage(run, 'AUDIO_ALIGNMENT', alignmentOutputSchema, async () => {
      const audio = await this.db.audioAsset.findMany({ where: { workspaceId: run.workspaceId, storyVersionId: version.id } });
      const bySegment = new Map(audio.map((item) => [item.segmentId, item]));
      let cursorMs = 0;
      const segments = script.segments.map((segment) => {
        const item = bySegment.get(segment.id);
        if (!item) throw new Error('AUDIO_ASSET_MISSING');
        const startMs = cursorMs;
        const endMs = startMs + item.durationMs;
        cursorMs = endMs + 100;
        return { segmentId: segment.id, startMs, endMs };
      });
      await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { timingPrecision: audio.length > 0 && audio.every((item) => item.timingPrecision === 'PROVIDER') ? 'PROVIDER' as const : 'APPROXIMATE' as const, segments };
    });
  }

  private async prepareAssets(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript) {
    await this.stage(run, 'ASSET_PREPARATION', assetPreparationOutputSchema, async () => {
      const [audio, background] = await Promise.all([
        this.db.audioAsset.findMany({ where: { workspaceId: run.workspaceId, storyVersionId: version.id }, include: { mediaAsset: true } }),
        input.backgroundAssetId ? this.db.mediaAsset.findFirst({ where: { id: input.backgroundAssetId, workspaceId: run.workspaceId, kind: 'BACKGROUND' } }) : Promise.resolve(null),
      ]);
      const bySegment = new Set(audio.map((item) => item.segmentId));
      if (script.segments.some((segment) => !bySegment.has(segment.id))) throw new Error('AUDIO_ASSET_MISSING');
      if (input.backgroundAssetId && (!background || !validBackgroundRights(background.rightsMetadata))) throw new Error('BLOCKED_RIGHTS');
      const assets = [...audio.map((item) => item.mediaAsset), ...(background ? [background] : [])];
      for (const asset of assets) await this.store.get(run.workspaceId, asset.checksum);
      await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { mediaAssetIds: assets.map((asset) => asset.id), ready: true };
    });
  }

  private async validateMedia(run: RunWithStory, input: ProductionInput, rendered: z.infer<typeof videoOutputSchema>) {
    return this.stage(run, 'MEDIA_VALIDATION', mediaValidationOutputSchema, async () => {
      const video = await this.db.video.findFirst({ where: { id: rendered.videoId, workspaceId: run.workspaceId }, include: { mediaAsset: true } });
      const metadata = video?.mediaAsset?.metadata;
      if (!video?.mediaAsset || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('MEDIA_VALIDATION_FAILED');
      const output = metadata as Record<string, Prisma.JsonValue>;
      const parsed = mediaValidationOutputSchema.parse({ ...rendered, width: output.width, height: output.height, fps: output.fps, codec: output.codec, audioCodec: output.audioCodec });
      await this.store.get(run.workspaceId, video.mediaAsset.checksum);
      await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return parsed;
    });
  }

  private async confirmStoredMedia(run: RunWithStory, input: ProductionInput, rendered: z.infer<typeof videoOutputSchema>) {
    return this.stage(run, 'STORAGE_UPLOAD', storageUploadOutputSchema, async () => {
      const asset = await this.db.mediaAsset.findFirst({ where: { id: rendered.mediaAssetId, workspaceId: run.workspaceId, kind: 'VIDEO' } });
      if (!asset) throw new Error('MEDIA_ASSET_MISSING');
      const bytes = await this.store.get(run.workspaceId, asset.checksum);
      if (bytes.byteLength < 1024) throw new Error('MEDIA_VALIDATION_FAILED');
      await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { videoId: rendered.videoId, mediaAssetId: asset.id, checksum: asset.checksum, sizeBytes: bytes.byteLength };
    });
  }

  private async createManifest(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript) {
    const existingStage = await this.db.productionStage.findUnique({ where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name: 'MANIFEST_CREATION' } } });
    if (existingStage?.status === 'SUCCEEDED') return manifestOutputSchema.parse(existingStage.output);
    const existing = await this.db.renderManifest.findFirst({ where: { workspaceId: run.workspaceId, productionRunId: run.id, version: 1 } });
    const audio = await this.db.audioAsset.findMany({ where: { workspaceId: run.workspaceId, storyVersionId: version.id }, include: { mediaAsset: true } });
    const bySegment = new Map(audio.map((item) => [item.segmentId, item]));
    const audioItems = script.segments.map((segment) => {
      const item = bySegment.get(segment.id);
      if (!item) throw new Error('AUDIO_ASSET_MISSING');
      return { assetId: item.mediaAsset.id, segmentId: segment.id, durationMs: item.durationMs };
    });
    const { manifest, checksum, subtitle } = createRenderManifest({
      storyProjectId: run.story.id, storyVersionId: version.id, storyVersion: version.version, sourcePostId: run.story.post.id,
      platform: safePlatform(run.story.post.platform), script, templateId: input.templateId, backgroundAssetId: input.backgroundAssetId,
      attribution: { required: run.story.post.rights[0]?.attributionRequired ?? false, text: run.story.post.rights[0]?.attributionText ?? null },
      visualSettings: { theme: input.theme, anonymizeAuthors: input.anonymizeAuthors, showEngagement: input.showEngagement }, audioAssets: audioItems, subtitlePreset: input.subtitlePreset,
    });
    if (existing && existing.checksum !== checksum) throw new Error('RENDER_MANIFEST_CONFLICT');
    const output = await this.stage(run, 'MANIFEST_CREATION', manifestOutputSchema, async () => {
      return this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        await tx.subtitleTrack.upsert({
          where: { workspaceId_storyVersionId_preset: { workspaceId: run.workspaceId, storyVersionId: version.id, preset: input.subtitlePreset } },
          create: { workspaceId: run.workspaceId, storyVersionId: version.id, language: script.language, preset: input.subtitlePreset, timingPrecision: subtitle.timingPrecision, timeline: subtitle.timeline as unknown as Prisma.InputJsonArray, srt: subtitle.srt },
          update: { language: script.language, timingPrecision: subtitle.timingPrecision, timeline: subtitle.timeline as unknown as Prisma.InputJsonArray, srt: subtitle.srt },
        });
        const renderManifest = existing ?? await tx.renderManifest.create({ data: { workspaceId: run.workspaceId, productionRunId: run.id, version: 1, checksum, manifest: manifest as unknown as Prisma.InputJsonObject } });
        const video = await tx.video.upsert({
          where: { workspaceId_productionRunId: { workspaceId: run.workspaceId, productionRunId: run.id } },
          create: { workspaceId: run.workspaceId, channelId: input.channelId, storyProjectId: run.story.id, storyVersionId: version.id, productionRunId: run.id, title: script.title, status: 'RENDERING', renderManifest: manifest as unknown as Prisma.InputJsonObject },
          update: { channelId: input.channelId, storyProjectId: run.story.id, storyVersionId: version.id, title: script.title, status: 'RENDERING', renderManifest: manifest as unknown as Prisma.InputJsonObject },
        });
        await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { videoId: video.id, status: 'RUNNING', progress: 0.6 } });
        return { manifestId: renderManifest.id, videoId: video.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    });
    return output;
  }

  private async render(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript, manifestOutput: z.infer<typeof manifestOutputSchema>) {
    return this.stage(run, 'VIDEO_RENDER', videoOutputSchema, async () => {
      const stored = await this.db.video.findFirst({ where: { id: manifestOutput.videoId, workspaceId: run.workspaceId }, include: { mediaAsset: true } });
      if (stored?.mediaAsset) return { videoId: stored.id, mediaAssetId: stored.mediaAsset.id };
      const [audioRows, background] = await Promise.all([
        this.db.audioAsset.findMany({ where: { workspaceId: run.workspaceId, storyVersionId: version.id }, include: { mediaAsset: true } }),
        input.backgroundAssetId ? this.db.mediaAsset.findFirst({ where: { id: input.backgroundAssetId, workspaceId: run.workspaceId, kind: 'BACKGROUND' } }) : Promise.resolve(null),
      ]);
      await this.assertRights(run, input);
      if (input.backgroundAssetId && !background) throw new Error('BLOCKED_RIGHTS');
      const audioSources: Record<string, string> = {};
      for (const row of audioRows) {
        const bytes = await this.store.get(run.workspaceId, row.mediaAsset.checksum);
        audioSources[row.mediaAsset.id] = `data:${row.mediaAsset.mimeType};base64,${bytes.toString('base64')}`;
      }
      const backgroundSrc = background ? `data:${background.mimeType};base64,${(await this.store.get(run.workspaceId, background.checksum)).toString('base64')}` : null;
      const comments = run.story.post.comments.filter((comment) => input.commentIds.includes(comment.id)).map((comment) => ({ id: comment.id, body: comment.body, authorAlias: null }));
      const manifestRecord = await this.db.renderManifest.findFirst({ where: { id: manifestOutput.manifestId, workspaceId: run.workspaceId } });
      if (!manifestRecord) throw new Error('RENDER_MANIFEST_MISSING');
      const compositionInput: CompositionInput = {
        manifest: manifestRecord.manifest as unknown as CompositionInput['manifest'],
        post: { title: run.story.post.title, body: run.story.post.body, authorAlias: run.story.post.authorAlias }, comments, backgroundSrc, audioSources,
      };
      const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-render-'));
      const outputPath = path.join(directory, 'video.mp4');
      try {
        let lastProgressAt = 0;
        let pending = Promise.resolve();
        await this.assertAutomationAction(run, false);
        const metadata = await renderVideo(compositionInput, outputPath, ({ progress }) => {
          if (Date.now() - lastProgressAt < 1500 && progress < 0.99) return;
          lastProgressAt = Date.now();
          pending = pending.then(async () => { await this.db.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { progress: Math.min(0.95, 0.65 + progress * 0.3) } }); });
        });
        await pending;
        await this.assertAutomationAction(run, false);
        const bytes = await readFile(outputPath);
        const object = await this.store.put(run.workspaceId, bytes);
        return this.db.$transaction(async (tx) => {
          await this.assertRunActive(tx, run, input);
          let asset = await tx.mediaAsset.findFirst({ where: { workspaceId: run.workspaceId, kind: 'VIDEO', checksum: object.checksum } });
          if (!asset) asset = await tx.mediaAsset.create({ data: {
            workspaceId: run.workspaceId, kind: 'VIDEO', storageKey: object.storageKey, checksum: object.checksum, mimeType: 'video/mp4',
            metadata: { width: metadata.width, height: metadata.height, fps: metadata.fps, durationMs: metadata.durationMs, codec: metadata.codec, audioCodec: metadata.audioCodec, sizeBytes: metadata.sizeBytes },
          } });
          const video = await tx.video.update({ where: { workspaceId_id: { workspaceId: run.workspaceId, id: manifestOutput.videoId } }, data: {
            status: 'READY_FOR_REVIEW', reviewStatus: 'PENDING', mediaAssetId: asset.id, durationMs: metadata.durationMs, width: metadata.width, height: metadata.height, fps: metadata.fps,
          } });
          await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { videoId: video.id, status: 'RUNNING', progress: 0.98 } });
          return { videoId: video.id, mediaAssetId: asset.id };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  private async startStage(run: RunWithStory, name: string) {
    return this.db.$transaction(async (tx) => {
      const active = await tx.productionRun.findFirst({ where: { id: run.id, workspaceId: run.workspaceId, status: 'RUNNING', attempts: run.attempts, workerLeaseUntil: { gt: new Date() } }, select: { id: true } });
      if (!active) throw new Error('WORKER_LEASE_LOST');
      const stage = await tx.productionStage.upsert({
        where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name } },
        create: { workspaceId: run.workspaceId, productionRunId: run.id, name, status: 'RUNNING', attempts: 1, startedAt: new Date() },
        update: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date(), completedAt: null, errorCode: null },
      });
      await tx.productionRun.updateMany({ where: { id: run.id, workspaceId: run.workspaceId, attempts: run.attempts }, data: { currentStage: name } });
      return stage;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async stage<T extends Record<string, unknown>>(run: RunWithStory, name: string, schema: z.ZodType<T>, work: () => Promise<T>): Promise<T> {
    const previous = await this.db.productionStage.findUnique({ where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name } } });
    if (previous?.status === 'SUCCEEDED') return schema.parse(previous.output);
    await this.startStage(run, name);
    try {
      const output = schema.parse(await work());
      await this.db.$transaction(async (tx) => {
        const currentRun = await tx.productionRun.findFirst({ where: { id: run.id, workspaceId: run.workspaceId, status: 'RUNNING', attempts: run.attempts, workerLeaseUntil: { gt: new Date() } }, select: { id: true } });
        if (!currentRun) throw new Error('BLOCKED_RIGHTS');
        await tx.productionStage.update({ where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name } }, data: { status: 'SUCCEEDED', output: asInputJson(output), completedAt: new Date(), errorCode: null } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return output;
    } catch (error) {
      const code = errorCode(error);
      await this.db.productionStage.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id, name }, data: { status: 'FAILED', errorCode: code, completedAt: new Date() } });
      throw error;
    }
  }
}
