import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, PrismaClient, type ContentRight, type ProductionRun, type StoryProject, type StoryVersion } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import { LocalObjectStore, assertGroundedScript, audioCacheKey, createRenderManifest, createScriptProvider, createTtsProvider, generateSubtitleTrack, listVoiceProfiles, productionInputSchema, renderManifestSchema, renderVideo, storyScriptSchema, type CompositionInput, type ProductionInput, type ScriptSource, type StoryScript } from '@shorts-factory/media';
import { sourceImageMetadataSchema, assertSourceImageBindings } from '@shorts-factory/media';
import { z } from 'zod';
import type { MediaWorkerConfig } from './config.js';
import type { MediaEnvelope } from './outbox.js';
import { customVoiceProfile, LocalNarrationProcessor, narrationDurationPlan, voicePreviewText, waveDurationMs } from '@shorts-factory/media';

const noopOutputSchema = z.object({ ok: z.literal(true) }).strict();
const audioOutputSchema = z.object({ ok: z.literal(true), audioAssetIds: z.array(z.string().uuid()).min(1).max(30) }).strict();
const versionOutputSchema = z.object({ versionId: z.string().uuid() }).strict();
const scriptOutputSchema = z.object({ script: storyScriptSchema, provider: z.string(), modelVersion: z.string() }).strict();
const manifestOutputSchema = z.object({ manifestId: z.string().uuid(), videoId: z.string().uuid() }).strict();
const videoOutputSchema = z.object({ videoId: z.string().uuid(), mediaAssetId: z.string().uuid() }).strict();
const wordTimingSchema = z.object({ text: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict();
const alignmentOutputSchema = z.object({ timingPrecision: z.enum(['PROVIDER', 'APPROXIMATE']), provider: z.string().optional(), adjustedWords: z.number().int().nonnegative().optional(), segments: z.array(z.object({ segmentId: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), providerTimings: z.array(wordTimingSchema).optional() }).strict()) }).strict();
const durationOutputSchema = audioOutputSchema.extend({ targetDurationSec: z.number(), originalDurationMs: z.number(), durationMs: z.number(), tempo: z.number() });
const assetPreparationOutputSchema = z.object({ mediaAssetIds: z.array(z.string().uuid()), ready: z.literal(true) }).strict();
const mediaValidationOutputSchema = videoOutputSchema.extend({ width: z.literal(1080), height: z.literal(1920), fps: z.literal(30), codec: z.literal('h264'), audioCodec: z.literal('aac') }).strict();
const storageUploadOutputSchema = videoOutputSchema.extend({ checksum: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive() }).strict();
const productionRequestVersionSchema = z.object({ version: z.number().int().positive().default(1) }).passthrough();

type RunWithStory = ProductionRun & {
  story: StoryProject & {
    post: {
      id: string; platform: string; title: string | null; body: string; authorAlias: string | null; deletedAt: Date | null; sensitiveFlags: string[]; rawPayload?: Prisma.JsonValue;
      comments: Array<{ id: string; body: string; sensitiveFlags: string[]; likes: number | null }>;
      rights: ContentRight[];
    };
    channel: { id: string; name: string; language: string } | null;
  };
};
type SelectedAudio = Prisma.AudioAssetGetPayload<{ include: { mediaAsset: true } }>;

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
  constructor(readonly db: PrismaClient, readonly config: MediaWorkerConfig, private readonly renderer: import('@shorts-factory/media').VideoRenderProvider = { id: 'remotion-local', render: renderVideo }) { this.store = new LocalObjectStore(path.resolve(config.STORAGE_LOCAL_ROOT)); }

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
    if (['SUCCEEDED', 'CANCELLED', 'BLOCKED_RIGHTS', 'BLOCKED_EXTERNAL', 'FAILED_PERMANENT'].includes(run.status)) return;
    const attemptLimit = job.version - 1 + maxAttempts;
    const now = new Date();
    const input = await this.db.$transaction(async (tx) => {
      const latest = await tx.outboxEvent.findFirst({
        where: { workspaceId: run.workspaceId, aggregateId: run.id, eventType: 'PRODUCTION_RUN_REQUESTED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { payload: true },
      });
      const request = productionRequestVersionSchema.safeParse(latest?.payload);
      // A delayed delivery cannot exhaust or claim a newer explicit retry's budget.
      if (!request.success || request.data.version !== job.version) return null;
      if (run.attempts >= attemptLimit) {
        const exhausted = await tx.productionRun.updateMany({ where: { id: run.id, workspaceId: run.workspaceId, attempts: run.attempts, OR: [{ status: { in: ['QUEUED', 'FAILED_RETRYABLE'] } }, { status: 'RUNNING', workerLeaseUntil: { lt: new Date() } }] }, data: { status: 'FAILED_PERMANENT', errorCode: 'ATTEMPTS_EXHAUSTED', completedAt: new Date(), workerLeaseUntil: null } });
        if (exhausted.count) await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { status: 'FAILED_PERMANENT', errorCode: 'ATTEMPTS_EXHAUSTED', completedAt: new Date() } });
        return null;
      }
      const input = productionInputSchema.parse(run.input);
      const active = await tx.productionRun.updateMany({
        where: {
          id: run.id,
          workspaceId: run.workspaceId,
          attempts: run.attempts,
          OR: [
            { status: { in: ['QUEUED', 'FAILED_RETRYABLE'] } },
            { status: 'RUNNING', OR: [{ workerLeaseUntil: null }, { workerLeaseUntil: { lt: now } }] },
          ],
        },
        data: { status: 'RUNNING', attempts: { increment: 1 }, workerLeaseUntil: new Date(now.getTime() + 90_000), startedAt: run.startedAt ?? now, errorCode: null },
      });
      return active.count ? input : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!input) return;
    const claimedRun: RunWithStory = { ...run, status: 'RUNNING', attempts: run.attempts + 1 };
    const leaseHeartbeat = setInterval(() => {
      void this.db.productionRun.updateMany({
        where: { id: claimedRun.id, workspaceId: claimedRun.workspaceId, status: 'RUNNING', attempts: claimedRun.attempts },
        data: { workerLeaseUntil: new Date(Date.now() + 90_000) },
      }).catch(() => undefined);
    }, 20_000);
    leaseHeartbeat.unref();
    try {
      await this.db.$transaction(async (tx) => {
        await this.assertAttemptActive(tx, claimedRun);
        await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { status: 'RUNNING', attempts: claimedRun.attempts, startedAt: new Date(), errorCode: null } });
      });
      await this.execute(claimedRun, input);
    } catch (error) {
      const code = errorCode(error);
      const blocked = isBlocked(code);
      const paused = code === 'AUTOMATION_PAUSED';
      const cancelled = code === 'AUTOMATION_CANCELLED' || code === 'USER_CANCELLED';
      const terminal = !paused && (['DURATION_TARGET_UNREACHABLE', 'SCRIPT_SENTENCE_TOO_LONG'].includes(code) || claimedRun.attempts >= attemptLimit || attemptsMade + 1 >= maxAttempts);
      const now = new Date();
      const status = cancelled ? 'CANCELLED' : blocked ? (code === 'BLOCKED_EXTERNAL' || code === 'PAID_PROVIDER_BUDGET_UNBOUNDED' ? 'BLOCKED_EXTERNAL' : 'BLOCKED_RIGHTS') : terminal ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE';
      await this.db.$transaction(async (tx) => {
        const updated = await tx.productionRun.updateMany({ where: { id: claimedRun.id, workspaceId: claimedRun.workspaceId, status: 'RUNNING', attempts: claimedRun.attempts }, data: { status, workerLeaseUntil: null, errorCode: code, completedAt: cancelled || blocked || terminal ? now : null } });
        if (!updated.count) return;
        await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id, status: 'RUNNING', attempts: claimedRun.attempts }, data: { status, errorCode: code, completedAt: cancelled || blocked || terminal ? now : null } });
        if (cancelled) {
          const parent = await tx.workflowRun.findFirst({ where: { workspaceId: run.workspaceId, entityType: 'AUTOPILOT', output: { path: ['productionRunId'], equals: run.id } }, select: { id: true } });
          if (parent) await tx.budgetReservation.updateMany({ where: { workspaceId: run.workspaceId, workflowRunId: parent.id, status: 'CLOSING' }, data: { status: 'RELEASED' } });
        }
      });
      if (!cancelled && code !== 'WORKER_LEASE_LOST') throw new Error(code);
    } finally {
      clearInterval(leaseHeartbeat);
      await this.db.productionRun.updateMany({ where: { id: claimedRun.id, workspaceId: claimedRun.workspaceId, attempts: claimedRun.attempts }, data: { workerLeaseUntil: null } });
    }
  }

  private async assertAttemptActive(tx: Prisma.TransactionClient, run: RunWithStory) {
    const active = await tx.productionRun.findFirst({ where: { id: run.id, workspaceId: run.workspaceId, status: 'RUNNING', attempts: run.attempts, workerLeaseUntil: { gt: new Date() } }, select: { id: true } });
    if (active) return;
    const current = await tx.productionRun.findFirst({ where: { id: run.id, workspaceId: run.workspaceId }, select: { status: true, attempts: true } });
    if (current?.status === 'CANCELLED' && current.attempts === run.attempts) throw new Error('USER_CANCELLED');
    throw new Error('WORKER_LEASE_LOST');
  }

  private watchRender(run: RunWithStory, controller: AbortController) {
    let pending = Promise.resolve();
    let checking = false;
    const timer = setInterval(() => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      pending = (async () => {
        const current = await this.db.productionRun.findFirst({ where: { id: run.id, workspaceId: run.workspaceId }, select: { status: true, attempts: true, workerLeaseUntil: true } });
        if (current?.status === 'CANCELLED' && current.attempts === run.attempts) throw new Error('USER_CANCELLED');
        if (!current || current.status !== 'RUNNING' || current.attempts !== run.attempts || !current.workerLeaseUntil || current.workerLeaseUntil.getTime() <= Date.now()) throw new Error('WORKER_LEASE_LOST');
        await this.assertAutomationAction(run, false);
      })().catch((error: unknown) => { controller.abort(new Error(errorCode(error) === 'MEDIA_PRODUCTION_FAILED' ? 'WORKER_STATE_UNAVAILABLE' : errorCode(error))); }).finally(() => { checking = false; });
    }, this.config.MEDIA_CANCEL_POLL_MS);
    timer.unref();
    return { stop: async () => { clearInterval(timer); await pending; } };
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
    const byId = new Map(post.comments.map((comment) => [comment.id, comment]));
    const comments = [...new Set(input.commentIds)].map((id) => {
      const comment = byId.get(id);
      if (!comment) throw new Error('COMMENT_NOT_IN_SOURCE');
      return { id: comment.id, body: comment.body };
    });
    return { id: post.id, platform: safePlatform(post.platform), title: post.title, body: post.body, comments };
  }

  private assertRights(run: RunWithStory, input: ProductionInput) {
    const rights = run.story.post.rights[0];
    if (!rights || rights.reviewStatus !== 'APPROVED' || !rights.attested || !rights.commercialAllowed || rights.revokedAt || (rights.expiresAt && rights.expiresAt.getTime() <= Date.now()) || rights.allowedPlatforms.length === 0 || (rights.attributionRequired && !rights.attributionText?.trim())) throw new Error('BLOCKED_RIGHTS');
    const post = run.story.post;
    const selectedComments = post.comments.filter((comment) => input.commentIds.includes(comment.id));
    if (post.deletedAt || post.sensitiveFlags.length || selectedComments.some((comment) => comment.sensitiveFlags.length)) throw new Error('BLOCKED_RIGHTS');
    return this.assertPresentationAssets(run.workspaceId, input);
  }

  private async assertRunActive(tx: Prisma.TransactionClient, run: RunWithStory, input: ProductionInput) {
    await this.assertAttemptActive(tx, run);
    const [post, background, music] = await Promise.all([
      tx.sourcePost.findFirst({ where: { id: run.story.post.id, workspaceId: run.workspaceId, deletedAt: null }, include: { comments: true, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
      input.backgroundAssetId ? tx.mediaAsset.findFirst({ where: { id: input.backgroundAssetId, workspaceId: run.workspaceId, kind: 'BACKGROUND' }, select: { rightsMetadata: true } }) : Promise.resolve(null),
      input.mediaSettings?.musicAssetId ? tx.mediaAsset.findFirst({ where: { id: input.mediaSettings.musicAssetId, workspaceId: run.workspaceId, kind: 'MUSIC' }, select: { rightsMetadata: true } }) : Promise.resolve(null),
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
    if (!post || !rights || rights.reviewStatus !== 'APPROVED' || !rights.attested || !rights.commercialAllowed || rights.revokedAt || (rights.expiresAt && rights.expiresAt.getTime() <= Date.now()) || rights.allowedPlatforms.length === 0 || (rights.attributionRequired && !rights.attributionText?.trim())) throw new Error('BLOCKED_RIGHTS');
    const selected = post.comments.filter((comment) => input.commentIds.includes(comment.id));
    if (post.sensitiveFlags.length || selected.length !== input.commentIds.length || selected.some((comment) => comment.sensitiveFlags.length)) throw new Error('BLOCKED_RIGHTS');
    if (input.backgroundAssetId && (!background || !validBackgroundRights(background.rightsMetadata))) throw new Error('BLOCKED_RIGHTS');
    if (input.mediaSettings?.musicAssetId && (!music || !validBackgroundRights(music.rightsMetadata))) throw new Error('BLOCKED_RIGHTS');
  }

  private async assertPresentationAssets(workspaceId: string, input: ProductionInput) {
    for (const [id, kind] of [[input.backgroundAssetId, 'BACKGROUND'], [input.mediaSettings?.musicAssetId, 'MUSIC']] as const) {
      if (!id) continue;
      const asset = await this.db.mediaAsset.findFirst({ where: { id, workspaceId, kind }, select: { rightsMetadata: true } });
      if (!asset || !validBackgroundRights(asset.rightsMetadata)) throw new Error('BLOCKED_RIGHTS');
    }
  }

  private async execute(run: RunWithStory, input: ProductionInput) {
    await this.assertRights(run, input);
    await this.sourceImages(run, input);
    const source = this.source(run, input);
    let version: StoryVersion;
    if (input.mode === 'CREATE' || input.mode === 'REGENERATE' || input.mode === 'SCRIPT_ONLY') version = await this.generateVersion(run, input, source);
    else version = await this.loadVersion(run.workspaceId, run.story.id, input.storyVersionId);

    const script = storyScriptSchema.parse(version.script);
    await this.stage(run, 'SCRIPT_VALIDATION', noopOutputSchema, async () => {
      assertGroundedScript(script, source);
      return { ok: true };
    });
    if (input.mode === 'SCRIPT_ONLY') {
      await this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        await tx.storyProject.updateMany({ where: { id: run.story.id, workspaceId: run.workspaceId }, data: { status: 'SCRIPT_READY' } });
        await tx.productionRun.updateMany({ where: { id: run.id, workspaceId: run.workspaceId }, data: { status: 'SUCCEEDED', currentStage: 'SCRIPT_READY', completedAt: new Date() } });
        await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { status: 'SUCCEEDED', progress: 1, completedAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    }
    let audio = await this.generateAudio(run, input, version, script);
    if (input.mode === 'AUDIO_ONLY') {
      await this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        await tx.storyProject.updateMany({ where: { id: run.story.id, workspaceId: run.workspaceId }, data: { status: 'AUDIO_READY' } });
        await tx.productionRun.updateMany({ where: { id: run.id, workspaceId: run.workspaceId }, data: { status: 'SUCCEEDED', currentStage: 'AUDIO_READY', completedAt: new Date() } });
        await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id }, data: { status: 'SUCCEEDED', progress: 1, completedAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    }
    if (input.audioTimed) audio = await this.fitAudioDuration(run, input, version, script, audio);
    await this.prepareAssets(run, input, script, audio);
    const alignment = await this.alignAudio(run, input, script, audio);
    await this.createSubtitles(run, input, version, script, alignment);
    const manifest = await this.createManifest(run, input, version, script, audio, alignment);
    const rendered = await this.render(run, input, manifest, audio);
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
    let narrationWordsPerSecond: number | undefined;
    if (input.audioTimed && input.voiceProfileId.startsWith('vieneu:') && (process.env.SCRIPT_PROVIDER ?? 'mock') === 'mock') {
      const calibration = await this.stage(run, 'SPEECH_CALIBRATION', z.object({ wordsPerSecond: z.number().positive().max(20) }).strict(), async () => {
        const speech = await this.speechContext(run, input);
        await this.assertAutomationAction(run, false);
        const result = await speech.provider.synthesize({ text: voicePreviewText, language: input.language, voiceId: input.voiceId, speakingRate: input.speakingRate, ...speech.reference });
        return { wordsPerSecond: voicePreviewText.split(/\s+/u).length / (result.durationMs / 1000) };
      });
      narrationWordsPerSecond = calibration.wordsPerSecond;
    }
    const generated = await this.stage(run, 'SCRIPT_GENERATION', scriptOutputSchema, async () => {
      if (input.candidateId) {
        const candidate = await this.db.contentCandidate.findFirst({ where: { id: input.candidateId, workspaceId: run.workspaceId }, select: { status: true } });
        if (candidate?.status !== 'APPROVED') throw new Error('CANDIDATE_NOT_APPROVED');
      }
      const provider = createScriptProvider();
      await this.assertAutomationAction(run, !provider.id.includes('mock'));
      const result = await provider.generate({ source, language: input.language, targetDurationSec: input.targetDurationSec, style: input.style, ...(narrationWordsPerSecond ? { narrationWordsPerSecond } : {}) });
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
    const selectedSegmentIds = input.selectedSegmentIds.length ? new Set(input.selectedSegmentIds) : null;
    const segments = input.mode === 'AUDIO_ONLY' && input.preview ? [{ id: 'voice-preview', text: voicePreviewText }] : script.segments.filter((segment) => !selectedSegmentIds || selectedSegmentIds.has(segment.id));
    if (!segments.length) throw new Error('AUDIO_SEGMENTS_REQUIRED');
    const previous = await this.db.productionStage.findUnique({ where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name: 'TTS_GENERATION' } } });
    if (previous?.status === 'SUCCEEDED' && !audioOutputSchema.safeParse(previous.output).success) {
      const savedManifest = await this.db.renderManifest.findFirst({ where: { workspaceId: run.workspaceId, productionRunId: run.id, version: 1 } });
      let restoredOutput: z.infer<typeof audioOutputSchema> | null = null;
      if (savedManifest) {
        const manifest = renderManifestSchema.parse(savedManifest.manifest);
        if (manifest.storyVersionId !== version.id) throw new Error('RENDER_MANIFEST_CONFLICT');
        const rows = await this.db.audioAsset.findMany({ where: { workspaceId: run.workspaceId, storyVersionId: version.id, mediaAssetId: { in: manifest.audioAssets.map((item) => item.assetId) } }, include: { mediaAsset: true } });
        const audioAssetIds = manifest.audioAssets.map((item) => {
          const row = rows.find((candidate) => candidate.segmentId === item.segmentId && candidate.mediaAsset.id === item.assetId);
          if (!row) throw new Error('AUDIO_ASSET_MISSING');
          return row.id;
        });
        restoredOutput = audioOutputSchema.parse({ ok: true, audioAssetIds });
      }
      await this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        if (restoredOutput) {
          // A persisted manifest is authoritative when resuming an older render.
          await tx.productionStage.update({ where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name: 'TTS_GENERATION' } }, data: { output: restoredOutput } });
        } else {
          await tx.productionStage.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id, name: { in: ['TTS_GENERATION', 'ASSET_PREPARATION', 'AUDIO_ALIGNMENT', 'SUBTITLE_GENERATION'] }, status: 'SUCCEEDED' }, data: { status: 'PENDING', output: Prisma.JsonNull, completedAt: null } });
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    const output = await this.stage(run, 'TTS_GENERATION', audioOutputSchema, async () => {
      const { provider, profile, reference } = await this.speechContext(run, input);
      const audioAssetIds: string[] = [];
      for (const segment of segments) {
        const synthesisInput = { text: segment.text, language: script.language, voiceId: input.voiceId, speakingRate: input.speakingRate, ...reference };
        const cacheKey = createHash('sha256').update(JSON.stringify([version.id, segment.id, audioCacheKey(synthesisInput, provider.id)])).digest('hex');
        const cached = await this.db.audioAsset.findFirst({ where: { workspaceId: run.workspaceId, cacheKey } });
        if (cached) { audioAssetIds.push(cached.id); continue; }
        await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        await this.assertAutomationAction(run, !provider.id.includes('mock') && !provider.id.includes('local'));
        const result = await provider.synthesize(synthesisInput);
        const object = await this.store.put(run.workspaceId, result.audio);
        const audioAssetId = await this.db.$transaction(async (tx) => {
          await this.assertRunActive(tx, run, input);
          const existing = await tx.audioAsset.findFirst({ where: { workspaceId: run.workspaceId, cacheKey } });
          if (existing) return existing.id;
          const media = await tx.mediaAsset.upsert({
            where: { workspaceId_storageKey: { workspaceId: run.workspaceId, storageKey: object.storageKey } },
            create: { workspaceId: run.workspaceId, kind: 'AUDIO', storageKey: object.storageKey, checksum: object.checksum, mimeType: result.mimeType, metadata: { provider: result.provider, voiceId: result.voiceId, durationMs: result.durationMs, timingPrecision: result.timingPrecision, usageUnits: result.usageUnits, estimatedCostUsd: result.estimatedCostUsd } },
            update: {},
          });
          const audio = await tx.audioAsset.create({ data: {
            workspaceId: run.workspaceId, storyVersionId: version.id, mediaAssetId: media.id, segmentId: segment.id, voiceProfileId: profile.id,
            provider: result.provider, cacheKey, durationMs: result.durationMs, timingPrecision: result.timingPrecision, usageUnits: result.usageUnits, estimatedCostUsd: result.estimatedCostUsd,
          } });
          return audio.id;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        audioAssetIds.push(audioAssetId);
      }
      await this.db.$transaction(async (tx) => {
        await this.assertRunActive(tx, run, input);
        await tx.storyProject.updateMany({ where: { id: run.story.id, workspaceId: run.workspaceId }, data: { status: 'AUDIO_READY' } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { ok: true, audioAssetIds };
    });
    const rows = await this.db.audioAsset.findMany({ where: { workspaceId: run.workspaceId, storyVersionId: version.id, id: { in: output.audioAssetIds } }, include: { mediaAsset: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const selected = output.audioAssetIds.map((id, index) => {
      const row = byId.get(id);
      if (!row || row.segmentId !== segments[index]?.id) throw new Error('AUDIO_ASSET_MISSING');
      return row;
    });
    if (selected.length !== segments.length) throw new Error('AUDIO_ASSET_MISSING');
    if (selected.reduce((total, row) => total + row.durationMs, 0) > this.config.MEDIA_MAX_RENDER_SECONDS * 1000) throw new Error('MEDIA_DURATION_EXCEEDED');
    return selected;
  }

  private async speechContext(run: RunWithStory, input: ProductionInput) {
    // Preserve queued eSpeak jobs when the local launcher switches to neural speech.
    const env = process.env.TTS_PROVIDER === 'vieneu' && input.voiceProfileId.startsWith('local:') ? { ...process.env, TTS_PROVIDER: 'local' } : process.env;
    const provider = createTtsProvider(env);
    const asset = input.voiceProfileId.startsWith('vieneu:custom:') && env.TTS_PROVIDER === 'vieneu' ? await this.db.mediaAsset.findFirst({ where: { workspaceId: run.workspaceId, id: input.voiceId, kind: 'VOICE_REFERENCE' } }) : null;
    const profile = asset ? customVoiceProfile(asset) : listVoiceProfiles(env).find((item) => item.id === input.voiceProfileId);
    if (!profile || profile.voiceId !== input.voiceId) throw new Error('VOICE_PROFILE_INVALID');
    const reference = asset ? { referenceAudio: await this.store.get(run.workspaceId, asset.checksum) } : {};
    return { provider, profile, reference };
  }

  private async fitAudioDuration(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript, audio: SelectedAudio[]) {
    const output = await this.stage(run, 'DURATION_FIT', durationOutputSchema, async () => {
      const plan = narrationDurationPlan(audio.map((item) => item.durationMs), input.targetDurationSec);
      const processor = new LocalNarrationProcessor();
      const audioAssetIds: string[] = [];
      let totalMs = (audio.length - 1) * 100;
      for (const [index, item] of audio.entries()) {
        const duration = plan.targetDurationsMs[index]!;
        const cacheKey = createHash('sha256').update(JSON.stringify(['duration-fit-v1', item.cacheKey, duration])).digest('hex');
        const cached = await this.db.audioAsset.findFirst({ where: { workspaceId: run.workspaceId, cacheKey } });
        if (cached) { audioAssetIds.push(cached.id); totalMs += cached.durationMs; continue; }
        await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        const bytes = await processor.retime(await this.store.get(run.workspaceId, item.mediaAsset.checksum), duration);
        const durationMs = waveDurationMs(bytes);
        if (Math.abs(durationMs - duration) > 50) throw new Error('AUDIO_RETIME_INVALID');
        const object = await this.store.put(run.workspaceId, bytes);
        const id = await this.db.$transaction(async (tx) => {
          await this.assertRunActive(tx, run, input);
          const existing = await tx.audioAsset.findFirst({ where: { workspaceId: run.workspaceId, cacheKey } });
          if (existing) return existing.id;
          const media = await tx.mediaAsset.upsert({ where: { workspaceId_storageKey: { workspaceId: run.workspaceId, storageKey: object.storageKey } }, create: { workspaceId: run.workspaceId, kind: 'AUDIO', storageKey: object.storageKey, checksum: object.checksum, mimeType: 'audio/wav', metadata: { provider: 'local-librosa-tempo-v1', durationMs, tempo: plan.tempo, originalAudioAssetId: item.id } }, update: {} });
          return (await tx.audioAsset.create({ data: { workspaceId: run.workspaceId, storyVersionId: version.id, mediaAssetId: media.id, segmentId: item.segmentId, voiceProfileId: item.voiceProfileId, provider: item.provider, cacheKey, durationMs, timingPrecision: 'APPROXIMATE', usageUnits: 0, estimatedCostUsd: 0 } })).id;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        audioAssetIds.push(id); totalMs += durationMs;
      }
      if (Math.abs(totalMs - input.targetDurationSec * 1000) > 100) throw new Error('AUDIO_RETIME_INVALID');
      return { ok: true, audioAssetIds, targetDurationSec: input.targetDurationSec, originalDurationMs: plan.originalDurationMs, durationMs: totalMs, tempo: plan.tempo };
    });
    const rows = await this.db.audioAsset.findMany({ where: { workspaceId: run.workspaceId, storyVersionId: version.id, id: { in: output.audioAssetIds } }, include: { mediaAsset: true } });
    const selected = output.audioAssetIds.map((id, index) => {
      const row = rows.find((item) => item.id === id && item.segmentId === script.segments[index]?.id);
      if (!row) throw new Error('AUDIO_ASSET_MISSING');
      return row;
    });
    if (selected.length !== script.segments.length) throw new Error('AUDIO_ASSET_MISSING');
    return selected;
  }

  private async createSubtitles(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript, alignment: z.infer<typeof alignmentOutputSchema>) {
    await this.stage(run, 'SUBTITLE_GENERATION', noopOutputSchema, async () => {
      const timeline = alignment.segments.map((item) => {
        const segment = script.segments.find((candidate) => candidate.id === item.segmentId);
        if (!segment) throw new Error('AUDIO_ASSET_MISSING');
        return { segment, startMs: item.startMs, endMs: item.endMs, providerTimings: item.providerTimings };
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

  private async alignAudio(run: RunWithStory, input: ProductionInput, script: StoryScript, audio: SelectedAudio[]) {
    return this.stage(run, 'AUDIO_ALIGNMENT', alignmentOutputSchema, async () => {
      const bySegment = new Map(audio.map((item) => [item.segmentId, item]));
      let cursorMs = 0;
      const segments: z.infer<typeof alignmentOutputSchema>['segments'] = [];
      let provider: string | undefined;
      let adjustedWords = 0;
      const processor = new LocalNarrationProcessor();
      try {
        for (const segment of script.segments) {
          const item = bySegment.get(segment.id);
          if (!item) throw new Error('AUDIO_ASSET_MISSING');
          const startMs = cursorMs;
          const endMs = startMs + item.durationMs;
          cursorMs = endMs + 100;
          let providerTimings: z.infer<typeof wordTimingSchema>[] | undefined;
          if (input.audioTimed) {
            await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            const aligned = await processor.align(await this.store.get(run.workspaceId, item.mediaAsset.checksum), segment.text, script.language, item.durationMs);
            provider = aligned.provider;
            adjustedWords += aligned.adjustedWords ?? 0;
            providerTimings = aligned.words.map((word) => ({ ...word, startMs: word.startMs + startMs, endMs: word.endMs + startMs }));
          }
          segments.push({ segmentId: segment.id, startMs, endMs, ...(providerTimings ? { providerTimings } : {}) });
        }
      } finally { if (input.audioTimed) await processor.release(); }
      await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { timingPrecision: input.audioTimed ? 'PROVIDER' as const : 'APPROXIMATE' as const, ...(provider ? { provider, adjustedWords } : {}), segments };
    });
  }

  private async prepareAssets(run: RunWithStory, input: ProductionInput, script: StoryScript, audio: SelectedAudio[]) {
    await this.stage(run, 'ASSET_PREPARATION', assetPreparationOutputSchema, async () => {
      const background = input.backgroundAssetId ? await this.db.mediaAsset.findFirst({ where: { id: input.backgroundAssetId, workspaceId: run.workspaceId, kind: 'BACKGROUND' } }) : null;
      const bySegment = new Set(audio.map((item) => item.segmentId));
      if (script.segments.some((segment) => !bySegment.has(segment.id))) throw new Error('AUDIO_ASSET_MISSING');
      if (input.backgroundAssetId && (!background || !validBackgroundRights(background.rightsMetadata))) throw new Error('BLOCKED_RIGHTS');
      const music = input.mediaSettings?.musicAssetId ? await this.db.mediaAsset.findFirst({ where: { workspaceId: run.workspaceId, id: input.mediaSettings.musicAssetId, kind: 'MUSIC' } }) : null;
      await this.assertPresentationAssets(run.workspaceId, input);
      const assets = [...audio.map((item) => item.mediaAsset), ...(background ? [background] : []), ...(music ? [music] : [])];
      for (const asset of assets) await this.store.get(run.workspaceId, asset.checksum);
      await this.db.$transaction((tx) => this.assertRunActive(tx, run, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { mediaAssetIds: assets.map((asset) => asset.id), ready: true };
    });
  }

  private async sourceImages(run: RunWithStory, input: ProductionInput): Promise<Record<string, string>> {
    const provenance = run.story.post.rawPayload;
    const captureRunId = provenance && typeof provenance === 'object' && !Array.isArray(provenance) ? provenance.captureRunId : undefined;
    if (typeof captureRunId === 'string' && !input.sourceImages) throw new Error('SOURCE_IMAGE_MISSING');
    assertSourceImageBindings(input, run.story.post.id);
    const sources: Record<string, string> = {};
    for (const binding of input.sourceImages ?? []) {
      const asset = await this.db.mediaAsset.findFirst({ where: { id: binding.assetId, workspaceId: run.workspaceId, kind: 'SOURCE_CAPTURE', checksum: binding.checksum } });
      const parsed = sourceImageMetadataSchema.safeParse(asset?.metadata);
      const text = binding.sourceRef === `post:${run.story.post.id}` ? run.story.post.body : run.story.post.comments.find(comment => `comment:${comment.id}` === binding.sourceRef)?.body;
      if (!asset || !parsed.success || !text || parsed.data.postId !== run.story.post.id || parsed.data.captureRunId !== captureRunId || parsed.data.sourceRef !== binding.sourceRef || parsed.data.variant !== (binding.anonymized ? 'ANONYMIZED' : 'ORIGINAL') || parsed.data.width !== binding.width || parsed.data.height !== binding.height || parsed.data.textHash !== createHash('sha256').update(text).digest('hex')) throw new Error('SOURCE_IMAGE_IDENTITY_CONFLICT');
      sources[binding.assetId] = `data:image/png;base64,${(await this.store.get(run.workspaceId, binding.checksum)).toString('base64')}`;
    }
    return sources;
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

  private async createManifest(run: RunWithStory, input: ProductionInput, version: StoryVersion, script: StoryScript, audio: SelectedAudio[], alignment: z.infer<typeof alignmentOutputSchema>) {
    const existingStage = await this.db.productionStage.findUnique({ where: { workspaceId_productionRunId_name: { workspaceId: run.workspaceId, productionRunId: run.id, name: 'MANIFEST_CREATION' } } });
    if (existingStage?.status === 'SUCCEEDED') return manifestOutputSchema.parse(existingStage.output);
    const existing = await this.db.renderManifest.findFirst({ where: { workspaceId: run.workspaceId, productionRunId: run.id, version: 1 } });
    const bySegment = new Map(audio.map((item) => [item.segmentId, item]));
    const audioItems = script.segments.map((segment) => {
      const item = bySegment.get(segment.id);
      if (!item) throw new Error('AUDIO_ASSET_MISSING');
      const timing = alignment.segments.find((entry) => entry.segmentId === segment.id);
      return { assetId: item.mediaAsset.id, segmentId: segment.id, durationMs: item.durationMs, ...(timing?.providerTimings ? { providerTimings: timing.providerTimings.map((word) => ({ ...word, startMs: word.startMs - timing.startMs, endMs: word.endMs - timing.startMs })) } : {}) };
    });
    const background = input.backgroundAssetId ? await this.db.mediaAsset.findFirst({ where: { id: input.backgroundAssetId, workspaceId: run.workspaceId, kind: 'BACKGROUND' } }) : null;
    const videoMeta = background?.mimeType === 'video/mp4' ? z.object({ durationMs: z.number().positive() }).parse(background.metadata) : null;
    const { manifest, checksum, subtitle } = createRenderManifest({
      storyProjectId: run.story.id, storyVersionId: version.id, storyVersion: version.version, sourcePostId: run.story.post.id,
      platform: safePlatform(run.story.post.platform), script, templateId: input.templateId, backgroundAssetId: input.backgroundAssetId,
      attribution: { required: run.story.post.rights[0]?.attributionRequired ?? false, text: run.story.post.rights[0]?.attributionText ?? null },
      visualSettings: { theme: input.theme, anonymizeAuthors: input.anonymizeAuthors, showEngagement: input.showEngagement }, audioAssets: audioItems, subtitlePreset: input.subtitlePreset,
      ...(input.mediaSettings ? { mediaSettings: input.mediaSettings } : {}),
      ...(videoMeta ? { backgroundVideo: { durationFrames: Math.ceil(videoMeta.durationMs / 1000 * 30), startFrame: Math.floor((input.mediaSettings?.backgroundStartSec ?? 0) * 30) } } : {}),
      ...(input.sourceImages ? { sourceImages: input.sourceImages } : {}),
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

  private async render(run: RunWithStory, input: ProductionInput, manifestOutput: z.infer<typeof manifestOutputSchema>, audioRows: SelectedAudio[]) {
    return this.stage(run, 'VIDEO_RENDER', videoOutputSchema, async () => {
      const stored = await this.db.video.findFirst({ where: { id: manifestOutput.videoId, workspaceId: run.workspaceId }, include: { mediaAsset: true } });
      if (stored?.mediaAsset) return { videoId: stored.id, mediaAssetId: stored.mediaAsset.id };
      const background = input.backgroundAssetId ? await this.db.mediaAsset.findFirst({ where: { id: input.backgroundAssetId, workspaceId: run.workspaceId, kind: 'BACKGROUND' } }) : null;
      await this.assertRights(run, input);
      if (input.backgroundAssetId && !background) throw new Error('BLOCKED_RIGHTS');
      const audioSources: Record<string, string> = {};
      for (const row of audioRows) {
        const bytes = await this.store.get(run.workspaceId, row.mediaAsset.checksum);
        audioSources[row.mediaAsset.id] = `data:${row.mediaAsset.mimeType};base64,${bytes.toString('base64')}`;
      }
      const backgroundSrc = background ? `data:${background.mimeType};base64,${(await this.store.get(run.workspaceId, background.checksum)).toString('base64')}` : null;
      const music = input.mediaSettings?.musicAssetId ? await this.db.mediaAsset.findFirst({ where: { workspaceId: run.workspaceId, id: input.mediaSettings.musicAssetId, kind: 'MUSIC' } }) : null;
      const musicSrc = music ? `data:${music.mimeType};base64,${(await this.store.get(run.workspaceId, music.checksum)).toString('base64')}` : null;
      const comments = run.story.post.comments.filter((comment) => input.commentIds.includes(comment.id)).map((comment) => ({ id: comment.id, body: comment.body, authorAlias: null }));
      const manifestRecord = await this.db.renderManifest.findFirst({ where: { id: manifestOutput.manifestId, workspaceId: run.workspaceId } });
      if (!manifestRecord) throw new Error('RENDER_MANIFEST_MISSING');
      const compositionInput: CompositionInput = {
        manifest: manifestRecord.manifest as unknown as CompositionInput['manifest'],
        post: { title: run.story.post.title, body: run.story.post.body, authorAlias: run.story.post.authorAlias }, comments, backgroundSrc, audioSources, ...(musicSrc ? { musicSrc } : {}),
        ...(input.sourceImages ? { sourceImageSources: await this.sourceImages(run, input) } : {}),
      };
      const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-render-'));
      const outputPath = path.join(directory, 'video.mp4');
      const controller = new AbortController();
      const watcher = this.watchRender(run, controller);
      try {
        let lastProgressAt = 0;
        let pending = Promise.resolve();
        await this.assertAutomationAction(run, false);
        const metadata = await this.renderer.render(compositionInput, outputPath, ({ progress }) => {
          if (Date.now() - lastProgressAt < 1500 && progress < 0.99) return;
          lastProgressAt = Date.now();
          pending = pending.then(async () => {
            await this.db.$transaction(async (tx) => {
              await this.assertAttemptActive(tx, run);
              await tx.renderJob.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id, status: 'RUNNING', attempts: run.attempts }, data: { progress: Math.min(0.95, 0.65 + progress * 0.3) } });
            });
          }).catch((error: unknown) => { controller.abort(new Error(errorCode(error))); });
        }, { signal: controller.signal, timeoutMs: this.config.MEDIA_RENDER_TIMEOUT_MS });
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
      } finally { await watcher.stop(); await rm(directory, { recursive: true, force: true }); }
    });
  }

  private async startStage(run: RunWithStory, name: string) {
    return this.db.$transaction(async (tx) => {
      await this.assertAttemptActive(tx, run);
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
    const attempt = await this.startStage(run, name);
    try {
      const output = schema.parse(await work());
      await this.db.$transaction(async (tx) => {
        await this.assertAttemptActive(tx, run);
        await tx.productionStage.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id, name, attempts: attempt.attempts }, data: { status: 'SUCCEEDED', output: asInputJson(output), completedAt: new Date(), errorCode: null } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return output;
    } catch (error) {
      const code = errorCode(error);
      await this.db.$transaction(async (tx) => {
        const active = await tx.productionRun.findFirst({ where: { id: run.id, workspaceId: run.workspaceId, status: 'RUNNING', attempts: run.attempts, workerLeaseUntil: { gt: new Date() } }, select: { id: true } });
        if (active) await tx.productionStage.updateMany({ where: { workspaceId: run.workspaceId, productionRunId: run.id, name, status: 'RUNNING', attempts: attempt.attempts }, data: { status: 'FAILED', errorCode: code, completedAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      throw error;
    }
  }
}
