import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Prisma, type ContentRight, type PrismaClient } from '@shorts-factory/database';
import { LocalObjectStore, assertGroundedScript, listVoiceProfiles, prepareBackgroundImage, productionInputSchema, storyScriptSchema, type ProductionInput, type ScriptSource } from '@shorts-factory/media';
import { AuthService, adminRoles, editRoles, reviewRoles, type AuthContext } from './auth/auth.service.js';
import { ApiError, notFound } from './errors.js';
import { mutationIdentity } from './idempotency.js';
import { selectTopComments } from '@shorts-factory/media';
import { customVoiceProfile, validateVoiceReference, type VoiceProfile } from '@shorts-factory/media';
import { z } from 'zod';
import { readCuratedCatalog, readCuratedFile } from '@shorts-factory/media';
import { sourceImageMetadataSchema, assertSourceImageBindings } from '@shorts-factory/media';
import { createHash } from 'node:crypto';
import { prepareStudioMedia, studioPresetSchema } from '@shorts-factory/media';
import { audioRequestSchema, backgroundUploadSchema, cancelRunSchema, editStorySchema, productionCreateSchema, productionRunQuerySchema, regenerateStorySchema, renderRequestSchema, storyRenderRequestSchema, videoReviewSchema } from './production.validation.js';

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
    const { workspaceId } = await this.auth.context(request);
    const assets = process.env.TTS_PROVIDER === 'vieneu' ? await this.db.mediaAsset.findMany({ where: { workspaceId, kind: 'VOICE_REFERENCE' }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, kind: true, metadata: true, rightsMetadata: true } }) : [];
    return { items: [...listVoiceProfiles().filter((profile) => !profile.requiresCredentials || Boolean(process.env.OPENAI_API_KEY)), ...assets.flatMap((asset) => { const profile = customVoiceProfile(asset); return profile ? [profile] : []; })] };
  }

  private async voiceProfile(workspaceId: string, id: string): Promise<VoiceProfile | undefined> {
    if (!id.startsWith('vieneu:custom:')) return listVoiceProfiles().find((profile) => profile.id === id);
    if (process.env.TTS_PROVIDER !== 'vieneu') return undefined;
    const assetId = z.string().uuid().safeParse(id.slice('vieneu:custom:'.length));
    if (!assetId.success) return undefined;
    const asset = await this.db.mediaAsset.findFirst({ where: { id: assetId.data, workspaceId, kind: 'VOICE_REFERENCE' }, select: { id: true, kind: true, metadata: true, rightsMetadata: true } });
    return asset ? customVoiceProfile(asset) : undefined;
  }

  async uploadVoice(request: Request, rawBytes: unknown) {
    const context = await this.auth.context(request, editRoles);
    if (process.env.TTS_PROVIDER !== 'vieneu') throw new ApiError(409, 'TTS_VIENEU_NOT_READY', 'Start the local VieNeu speech service before adding a voice.');
    if (!['audio/wav', 'audio/x-wav'].includes(request.header('content-type')?.split(';')[0]?.trim() ?? '') || !Buffer.isBuffer(rawBytes)) throw new ApiError(400, 'VOICE_REFERENCE_INVALID', 'Use a 3–15 second PCM16 WAV reference.');
    if (request.header('x-voice-consent') !== 'true') throw new ApiError(400, 'VOICE_CONSENT_REQUIRED', 'Confirm that this is your voice or that the speaker authorized this use.');
    let decodedName: string;
    try { decodedName = decodeURIComponent(request.header('x-voice-name') ?? ''); } catch { throw new ApiError(400, 'VOICE_NAME_INVALID', 'Choose a valid voice name.'); }
    const name = z.string().trim().min(1).max(80).parse(decodedName);
    let durationMs: number;
    try { durationMs = validateVoiceReference(rawBytes); } catch { throw new ApiError(400, 'VOICE_REFERENCE_INVALID', 'Use a 3–15 second PCM16 WAV reference under 3 MB.'); }
    const object = await objectStore().put(context.workspaceId, rawBytes);
    return this.mutation(request, context, '/voice-profiles', { checksum: object.checksum, name, attested: true }, async (tx) => {
      const existing = await tx.mediaAsset.findUnique({ where: { workspaceId_storageKey: { workspaceId: context.workspaceId, storageKey: object.storageKey } } });
      if (existing && existing.kind !== 'VOICE_REFERENCE') throw new ApiError(409, 'VOICE_ASSET_CONFLICT', 'This reference is already stored as another media type. Use a separate recording.');
      const asset = existing ?? await tx.mediaAsset.create({ data: { workspaceId: context.workspaceId, kind: 'VOICE_REFERENCE', storageKey: object.storageKey, checksum: object.checksum, mimeType: 'audio/wav', metadata: { name, provider: 'vieneu', durationMs }, rightsMetadata: { attested: true, approved: true, uploadedById: context.userId } } });
      await this.audit(tx, context, 'VOICE_REFERENCE_UPLOADED', 'MediaAsset', asset.id, { durationMs });
      return { id: `vieneu:custom:${asset.id}`, name, provider: 'vieneu' };
    });
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
    if (request.header('content-type')?.split(';')[0]?.trim() === 'video/mp4') return this.uploadLibraryMedia(request, rawBytes, 'BACKGROUND');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(request.header('content-type')?.split(';')[0]?.trim() ?? '')) throw new ApiError(400, 'BACKGROUND_FORMAT_INVALID', 'Upload a PNG, JPEG, or WebP background image.');
    if (!Buffer.isBuffer(rawBytes)) throw new ApiError(400, 'BACKGROUND_FILE_REQUIRED', 'Upload a background image as the request body.');
    let name: string; let evidence: string;
    try { name = request.header('x-asset-encoding') === 'uri' ? decodeURIComponent(request.header('x-asset-name') ?? '') : request.header('x-asset-name') ?? ''; evidence = request.header('x-asset-encoding') === 'uri' ? decodeURIComponent(request.header('x-rights-evidence') ?? '') : request.header('x-rights-evidence') ?? ''; }
    catch { throw new ApiError(400, 'MEDIA_HEADERS_INVALID', 'Tên file hoặc thông tin quyền không hợp lệ.'); }
    const headers = backgroundUploadSchema.parse({ name, basis: request.header('x-rights-basis'), attested: request.header('x-rights-attested'), evidence: evidence || undefined });
    let prepared: Awaited<ReturnType<typeof prepareBackgroundImage>>;
    try { prepared = await prepareBackgroundImage(rawBytes); } catch { throw new ApiError(400, 'BACKGROUND_FORMAT_INVALID', 'Chọn ảnh PNG, JPEG hoặc WebP hợp lệ dưới 20 MB.'); }
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

  async music(request: Request) {
    const { workspaceId } = await this.auth.context(request);
    const items = await this.db.mediaAsset.findMany({ where: { workspaceId, kind: 'MUSIC' }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { items: items.filter(validBackgroundRights).map(asset => ({ id: asset.id, mimeType: asset.mimeType, metadata: asset.metadata, url: `/api/v1/media/${asset.id}` })) };
  }

  async curatedMedia(request: Request) {
    await this.auth.context(request);
    return { items: (await readCuratedCatalog()).map(({ file: _file, thumbnail: _thumbnail, ...entry }) => entry) };
  }

  async previewCuratedMedia(request: Request, key: string, response: Response, thumbnail: boolean) {
    await this.auth.context(request);
    let asset: Awaited<ReturnType<typeof readCuratedFile>>;
    try { asset = await readCuratedFile(key, thumbnail); }
    catch { return notFound(); }
    response.setHeader('Cache-Control', 'private, no-store');
    return new Promise<void>((resolve, reject) => response.sendFile(path.basename(asset.filePath), { root: path.dirname(asset.filePath) }, error => error ? reject(error) : resolve()));
  }

  async installCuratedMedia(request: Request, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = z.object({ keys: z.array(z.string().regex(/^[a-z0-9-]{1,80}$/)).min(1).max(40) }).strict().parse(raw);
    if (new Set(input.keys).size !== input.keys.length) throw new ApiError(400, 'CURATED_KEYS_DUPLICATED', 'Mỗi tài nguyên chỉ chọn một lần.');
    const prepared: Array<{ entry: Awaited<ReturnType<typeof readCuratedFile>>['entry']; media: { mimeType: string; durationMs: number; width?: number; height?: number }; object: Awaited<ReturnType<ReturnType<typeof objectStore>['put']>> }> = [];
    for (const key of input.keys) {
      let asset: Awaited<ReturnType<typeof readCuratedFile>>;
      try { asset = await readCuratedFile(key); }
      catch { throw new ApiError(409, 'CURATED_MEDIA_UNAVAILABLE', 'Bộ tài nguyên chưa sẵn sàng hoặc đã thay đổi. Chạy pnpm local:media:setup.'); }
      const media = await prepareStudioMedia(asset.bytes, asset.entry.kind, asset.entry.mimeType);
      const object = await objectStore().put(context.workspaceId, media.bytes);
      const { bytes: _bytes, ...metadata } = media;
      prepared.push({ entry: asset.entry, media: metadata, object });
    }
    return this.mutation(request, context, '/studio-assets', input, async tx => {
      const items: Array<{ key: string; kind: string; id: string }> = [];
      for (const { entry, media, object } of prepared) {
        const old = await tx.mediaAsset.findUnique({ where: { workspaceId_storageKey: { workspaceId: context.workspaceId, storageKey: object.storageKey } } });
        if (old && (old.kind !== entry.kind || !validBackgroundRights(old))) throw new ApiError(409, 'MEDIA_ASSET_CONFLICT', 'Tài nguyên trùng với file có loại hoặc quyền khác.');
        const asset = old ?? await tx.mediaAsset.create({ data: { workspaceId: context.workspaceId, kind: entry.kind, mimeType: media.mimeType, checksum: object.checksum, storageKey: object.storageKey,
          metadata: { name: entry.name, category: entry.category, artist: entry.artist, sourceUrl: entry.sourceUrl, license: entry.license, licenseUrl: entry.licenseUrl, curatedKey: entry.key, durationMs: media.durationMs, sizeBytes: object.size, ...(typeof media.width === 'number' && typeof media.height === 'number' ? { width: media.width, height: media.height } : {}) },
          rightsMetadata: { basis: 'LICENSED', approved: true, attested: true, commercialAllowed: true, evidence: `${entry.license} · ${entry.sourceUrl} · verified ${entry.verifiedAt}`, importedById: context.userId },
        } });
        if (!old) await this.audit(tx, context, 'CURATED_MEDIA_IMPORTED', 'MediaAsset', asset.id, { key: entry.key, license: entry.license });
        items.push({ key: entry.key, kind: entry.kind, id: asset.id });
      }
      return { items };
    });
  }

  async uploadMusic(request: Request, bytes: unknown) { return this.uploadLibraryMedia(request, bytes, 'MUSIC'); }

  private async uploadLibraryMedia(request: Request, rawBytes: unknown, kind: 'BACKGROUND' | 'MUSIC') {
    const context = await this.auth.context(request, editRoles);
    if (!Buffer.isBuffer(rawBytes)) throw new ApiError(400, 'MEDIA_FILE_REQUIRED', 'Chọn file MP4 H.264 cho nền hoặc WAV PCM16 cho nhạc.');
    let name: string; let evidence: string;
    try { name = request.header('x-asset-encoding') === 'uri' ? decodeURIComponent(request.header('x-asset-name') ?? '') : request.header('x-asset-name') ?? ''; evidence = request.header('x-asset-encoding') === 'uri' ? decodeURIComponent(request.header('x-rights-evidence') ?? '') : request.header('x-rights-evidence') ?? ''; }
    catch { throw new ApiError(400, 'MEDIA_HEADERS_INVALID', 'Tên file hoặc thông tin quyền không hợp lệ.'); }
    const headers = backgroundUploadSchema.parse({ name, basis: request.header('x-rights-basis'), attested: request.header('x-rights-attested'), evidence: evidence || undefined });
    let prepared: Awaited<ReturnType<typeof prepareStudioMedia>>;
    try { prepared = await prepareStudioMedia(rawBytes, kind, request.header('content-type')?.split(';')[0]?.trim() ?? ''); }
    catch { throw new ApiError(400, 'MEDIA_UPLOAD_INVALID', 'Dùng MP4 H.264 1–300 giây, tối đa 4K/60fps hoặc WAV PCM16 1–600 giây; file dưới 20 MB.'); }
    const object = await objectStore().put(context.workspaceId, prepared.bytes);
    return this.mutation(request, context, kind === 'MUSIC' ? '/music' : '/backgrounds', { checksum: object.checksum, ...headers }, async tx => {
      const existing = await tx.mediaAsset.findUnique({ where: { workspaceId_storageKey: { workspaceId: context.workspaceId, storageKey: object.storageKey } } });
      if (existing && (existing.kind !== kind || !validBackgroundRights(existing))) throw new ApiError(409, 'MEDIA_ASSET_CONFLICT', 'File này đã lưu với loại hoặc quyền khác. Chọn một file mới.');
      const asset = existing ?? await tx.mediaAsset.create({ data: {
        workspaceId: context.workspaceId, kind, storageKey: object.storageKey, checksum: object.checksum, mimeType: prepared.mimeType,
        metadata: { name: headers.name, durationMs: prepared.durationMs, sizeBytes: object.size, ...('width' in prepared ? { width: prepared.width, height: prepared.height } : {}) },
        rightsMetadata: { basis: headers.basis, attested: true, approved: true, commercialAllowed: true, evidence: headers.evidence ?? null, uploadedById: context.userId },
      } });
      await this.audit(tx, context, `${kind}_UPLOADED`, 'MediaAsset', asset.id);
      return { id: asset.id, url: `/api/v1/media/${asset.id}`, mimeType: asset.mimeType };
    });
  }

  async presets(request: Request) {
    const { workspaceId } = await this.auth.context(request);
    return { items: await this.db.studioPreset.findMany({ where: { workspaceId }, orderBy: { updatedAt: 'desc' }, take: 100 }) };
  }

  async savePreset(request: Request, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = studioPresetSchema.parse(raw);
    if (!await this.voiceProfile(context.workspaceId, input.settings.voiceProfileId)) throw new ApiError(400, 'VOICE_PROFILE_INVALID', 'Chọn giọng đang khả dụng.');
    return this.mutation(request, context, '/studio-presets', input, async tx => {
      await this.assertPresentationAssets(context.workspaceId, input.settings, tx);
      const preset = await tx.studioPreset.upsert({ where: { workspaceId_name: { workspaceId: context.workspaceId, name: input.name } }, create: { workspaceId: context.workspaceId, name: input.name, settings: input.settings }, update: { settings: input.settings } });
      await this.audit(tx, context, 'STUDIO_PRESET_SAVED', 'StudioPreset', preset.id);
      return { id: preset.id, name: preset.name, settings: input.settings };
    });
  }

  private async assertPresentationAssets(workspaceId: string, settings: { backgroundAssetId: string | null; mediaSettings?: ProductionInput['mediaSettings'] }, db: Prisma.TransactionClient = this.db) {
    if (settings.backgroundAssetId) {
      const asset = await db.mediaAsset.findFirst({ where: { id: settings.backgroundAssetId, workspaceId, kind: 'BACKGROUND' } });
      if (!asset || !validBackgroundRights(asset)) throw new ApiError(409, 'BACKGROUND_RIGHTS_INVALID', 'Chọn nền có quyền sử dụng trong workspace.');
      if (asset.mimeType === 'video/mp4') {
        const meta = z.object({ durationMs: z.number().positive() }).safeParse(asset.metadata);
        if (!meta.success || (settings.mediaSettings?.backgroundStartSec ?? 0) * 1000 >= meta.data.durationMs) throw new ApiError(400, 'BACKGROUND_START_INVALID', 'Điểm bắt đầu phải nằm trong video nền.');
      }
    }
    if (settings.mediaSettings?.musicAssetId) {
      const asset = await db.mediaAsset.findFirst({ where: { id: settings.mediaSettings.musicAssetId, workspaceId, kind: 'MUSIC' } });
      if (!asset || !validBackgroundRights(asset)) throw new ApiError(409, 'MUSIC_RIGHTS_INVALID', 'Chọn nhạc có quyền sử dụng trong workspace.');
    }
  }

  async createFromCandidate(request: Request, candidateId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = productionCreateSchema.parse(raw);
    const profile = await this.voiceProfile(context.workspaceId, input.voiceProfileId);
    if (!profile) throw new ApiError(400, 'VOICE_PROFILE_INVALID', 'Choose an available voice profile.');
    if (profile.language !== 'multilingual' && profile.language.toLowerCase() !== input.language.slice(0, 2).toLowerCase()) throw new ApiError(400, 'VOICE_LANGUAGE_MISMATCH', 'Choose a voice profile that supports the selected language.');
    const candidate = await this.db.contentCandidate.findFirst({ where: { id: candidateId, workspaceId: context.workspaceId }, include: { post: { include: { comments: true, rights: { orderBy: { createdAt: 'desc' }, take: 1 } } } } });
    if (!candidate) return notFound();
    if (candidate.status !== 'APPROVED') throw new ApiError(409, 'CANDIDATE_NOT_APPROVED', 'Approve the candidate after rights and safety review before production.');
    assertRights(candidate.post.rights[0]);
    assertSafeText(candidate.post, candidate.post.comments);
    const commentsById = new Map(candidate.post.comments.map((comment) => [comment.id, comment]));
    const selectedIds = input.commentSelection === 'TOP_REACTIONS' ? selectTopComments([...candidate.post.comments].sort((a, b) => a.id.localeCompare(b.id)), input.targetDurationSec).items.map((comment) => comment.id) : input.commentIds;
    const selected = selectedIds.map((id) => {
      const comment = commentsById.get(id);
      if (!comment) throw new ApiError(400, 'COMMENT_NOT_IN_SOURCE', 'Select comments that belong to this source post.');
      return comment;
    });
    assertSafeText(candidate.post, selected);
    const channel = await this.db.contentChannel.findFirst({ where: { id: input.channelId, workspaceId: context.workspaceId }, select: { id: true } });
    if (!channel) return notFound();
    const normalized = await this.buildInput(context.workspaceId, {
      mode: input.draftOnly ? 'SCRIPT_ONLY' : 'CREATE', candidateId, channelId: input.channelId, commentIds: selectedIds,
      language: input.language, targetDurationSec: input.targetDurationSec, style: input.style, voiceProfileId: profile.id, voiceId: profile.voiceId,
      speakingRate: input.speakingRate, templateId: input.templateId, backgroundAssetId: input.backgroundAssetId ?? null,
      subtitlePreset: input.subtitlePreset, theme: input.theme, anonymizeAuthors: input.anonymizeAuthors, showEngagement: input.showEngagement,
      ...(input.mediaSettings ? { mediaSettings: input.mediaSettings } : {}),
      selectedSegmentIds: [], storyVersionId: null, ...(profile.provider === 'vieneu' ? { audioTimed: true } : {}),
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
    const base = { ...lastInput.data }; delete base.preview; delete base.audioTimed;
    const profile = await this.voiceProfile(context.workspaceId, changes.voiceProfileId ?? base.voiceProfileId);
    if (!profile) throw new ApiError(400, 'VOICE_PROFILE_INVALID', 'Choose an available voice profile.');
    if (profile.language !== 'multilingual' && profile.language.toLowerCase() !== base.language.slice(0, 2).toLowerCase()) throw new ApiError(400, 'VOICE_LANGUAGE_MISMATCH', 'Choose a voice profile that supports the script language.');
    const selectedCommentIds = changes.commentSelection === 'TOP_REACTIONS' ? selectTopComments([...story.post.comments].sort((a, b) => a.id.localeCompare(b.id)), changes.targetDurationSec ?? base.targetDurationSec).items.map((comment) => comment.id) : changes.commentIds ?? base.commentIds;
    const settings = { ...changes }; delete settings.draftOnly; delete settings.commentSelection;
    const input = productionInputSchema.parse({ ...base, ...settings, mode: changes.draftOnly ? 'SCRIPT_ONLY' : 'REGENERATE', storyVersionId: null, selectedSegmentIds: [], commentIds: selectedCommentIds, targetDurationSec: changes.targetDurationSec ?? base.targetDurationSec, style: changes.style ?? base.style, voiceProfileId: profile.id, voiceId: profile.voiceId, speakingRate: changes.speakingRate ?? base.speakingRate, ...(profile.provider === 'vieneu' ? { audioTimed: true } : {}) });
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
    const profile = await this.voiceProfile(context.workspaceId, changes.voiceProfileId ?? last.data.voiceProfileId);
    if (!profile) throw new ApiError(400, 'VOICE_PROFILE_INVALID', 'Choose an available voice profile.');
    const prior = { ...last.data }; delete prior.preview;
    const input = productionInputSchema.parse({ ...prior, mode: 'AUDIO_ONLY', storyVersionId: version.id, voiceProfileId: profile.id, voiceId: profile.voiceId, speakingRate: changes.speakingRate ?? last.data.speakingRate, selectedSegmentIds: changes.segmentIds ?? [], ...(changes.preview ? { preview: true } : {}) });
    return this.mutation(request, context, `/stories/${storyId}/audio`, changes, async (tx) => this.enqueue(tx, context, story.id, input, `/stories/${storyId}/audio`));
  }

  async renderStory(request: Request, storyId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const changes = storyRenderRequestSchema.parse(raw);
    const story = await this.db.storyProject.findFirst({ where: { id: storyId, workspaceId: context.workspaceId }, include: { post: { include: { rights: { orderBy: { createdAt: 'desc' }, take: 1 }, comments: true } }, versions: { orderBy: { version: 'desc' }, take: 1 }, productionRuns: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!story) return notFound();
    assertRights(story.post.rights[0]);
    assertSafeText(story.post, story.post.comments);
    const latest = story.versions[0];
    const prior = story.productionRuns[0] ? productionInputSchema.safeParse(story.productionRuns[0].input) : null;
    if (!latest || !prior?.success) throw new ApiError(409, 'SCRIPT_REQUIRED', 'Save a script before rendering a video.');
    const profile = await this.voiceProfile(context.workspaceId, changes.voiceProfileId ?? prior.data.voiceProfileId);
    if (!profile) throw new ApiError(400, 'VOICE_PROFILE_INVALID', 'Choose an available voice profile.');
    if (profile.language !== 'multilingual' && profile.language.toLowerCase() !== prior.data.language.slice(0, 2).toLowerCase()) throw new ApiError(400, 'VOICE_LANGUAGE_MISMATCH', 'Choose a voice profile that supports the script language.');
    const base = { ...prior.data }; delete base.preview; delete base.audioTimed;
    const input = productionInputSchema.parse({ ...base, ...changes, voiceProfileId: profile.id, voiceId: profile.voiceId, mode: 'RENDER', storyVersionId: latest.id, selectedSegmentIds: [], ...(profile.provider === 'vieneu' ? { audioTimed: true } : {}) });
    await this.assertPresentationAssets(context.workspaceId, input);
    return this.mutation(request, context, `/stories/${storyId}/render`, changes, async (tx) => {
      const current = await tx.storyProject.findFirst({ where: { id: storyId, workspaceId: context.workspaceId }, include: { post: { include: { rights: { orderBy: { createdAt: 'desc' }, take: 1 }, comments: true } }, versions: { orderBy: { version: 'desc' }, take: 1 } } });
      if (!current) return notFound();
      assertRights(current.post.rights[0]);
      assertSafeText(current.post, current.post.comments);
      if (current.versions[0]?.id !== latest.id) throw new ApiError(409, 'CONCURRENT_CHANGE', 'The script changed. Reload the saved version before rendering.');
      return this.enqueue(tx, context, story.id, input, `/stories/${storyId}/render`);
    });
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
    const input = productionInputSchema.parse({ ...prior.data, mode: 'RENDER', storyVersionId: latest.id, selectedSegmentIds: [], templateId: changes.templateId ?? prior.data.templateId, backgroundAssetId, subtitlePreset: changes.subtitlePreset ?? prior.data.subtitlePreset, theme: changes.theme ?? prior.data.theme, anonymizeAuthors: changes.anonymizeAuthors ?? prior.data.anonymizeAuthors, showEngagement: changes.showEngagement ?? prior.data.showEngagement, ...(changes.mediaSettings ? { mediaSettings: changes.mediaSettings } : {}) });
    await this.assertPresentationAssets(context.workspaceId, input);
    return this.mutation(request, context, `/videos/${videoId}/render`, changes, async (tx) => this.enqueue(tx, context, video.story?.id ?? '', input, `/videos/${videoId}/render`));
  }

  async productionRun(request: Request, runId: string) {
    const context = await this.auth.context(request);
    const run = await this.db.productionRun.findFirst({ where: { id: runId, workspaceId: context.workspaceId }, include: {
      stages: { orderBy: { id: 'asc' } }, renderJob: true,
      videos: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1, include: { mediaAsset: { select: { id: true, mimeType: true, checksum: true, metadata: true } } } },
      story: { select: { id: true, sourcePostId: true, channelId: true, post: { select: { id: true, title: true } }, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true } } } },
    } });
    if (!run) return notFound();
    return { ...run, sourcePostId: run.story.sourcePostId, channelId: run.story.channelId, title: run.story.post.title };
  }

  async productionRuns(request: Request, rawQuery: unknown) {
    const context = await this.auth.context(request);
    const input = productionRunQuerySchema.parse(rawQuery);
    if (input.cursor && !await this.db.productionRun.findFirst({ where: { id: input.cursor, workspaceId: context.workspaceId }, select: { id: true } })) return notFound();
    const rows = await this.db.productionRun.findMany({
      where: { workspaceId: context.workspaceId, ...(input.status ? { status: input.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
        id: true, storyProjectId: true, status: true, currentStage: true, attempts: true, errorCode: true,
        createdAt: true, startedAt: true, completedAt: true,
        renderJob: { select: { progress: true, status: true } },
        story: { select: { sourcePostId: true, channelId: true, post: { select: { title: true } } } },
        videos: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, reviewStatus: true, mediaAsset: { select: { id: true, mimeType: true } } } },
      },
    });
    return {
      items: rows.slice(0, input.limit).map(({ story, ...run }) => ({ ...run, title: story.post.title, sourcePostId: story.sourcePostId, channelId: story.channelId })),
      nextCursor: rows.length > input.limit ? rows[input.limit - 1]?.id ?? null : null,
    };
  }

  async cancelRun(request: Request, runId: string, raw: unknown) {
    const context = await this.auth.context(request, editRoles);
    const input = cancelRunSchema.parse(raw);
    return this.mutation(request, context, `/production-runs/${runId}/cancel`, input, async (tx) => {
      const run = await tx.productionRun.findFirst({ where: { id: runId, workspaceId: context.workspaceId } });
      if (!run) return notFound();
      if (run.status === 'CANCELLED') return { runId, status: 'CANCELLED' };
      if (!['QUEUED', 'RUNNING', 'FAILED_RETRYABLE'].includes(run.status)) throw new ApiError(409, 'RUN_NOT_CANCELLABLE', 'Only queued, running or retryable production work can be cancelled.');
      const now = new Date();
      const changed = await tx.productionRun.updateMany({
        where: { id: runId, workspaceId: context.workspaceId, status: run.status, attempts: run.attempts },
        data: { status: 'CANCELLED', errorCode: 'USER_CANCELLED', completedAt: now },
      });
      if (!changed.count) throw new ApiError(409, 'CONCURRENT_CHANGE', 'The run changed. Reload its current status.');
      await tx.renderJob.updateMany({ where: { workspaceId: context.workspaceId, productionRunId: runId, status: { in: ['QUEUED', 'RUNNING', 'FAILED_RETRYABLE'] } }, data: { status: 'CANCELLED', errorCode: 'USER_CANCELLED', completedAt: now } });
      await tx.productionStage.updateMany({ where: { workspaceId: context.workspaceId, productionRunId: runId, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'FAILED', errorCode: 'USER_CANCELLED', completedAt: now } });
      await tx.video.updateMany({ where: { workspaceId: context.workspaceId, productionRunId: runId, reviewStatus: 'PENDING' }, data: { status: 'CANCELLED' } });
      await this.audit(tx, context, 'PRODUCTION_CANCELLED', 'ProductionRun', runId, { previousStatus: run.status, attempt: run.attempts });
      return { runId, status: 'CANCELLED' };
    });
  }

  async videos(request: Request) {
    const context = await this.auth.context(request);
    return { items: await this.db.video.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: 'desc' }, take: 50, include: { mediaAsset: { select: { id: true, mimeType: true, checksum: true, metadata: true } }, channel: { select: { id: true, name: true } }, renderJob: true } }) };
  }

  async video(request: Request, videoId: string) {
    const context = await this.auth.context(request);
    const video = await this.db.video.findFirst({ where: { id: videoId, workspaceId: context.workspaceId }, include: { productionRun: { select: { input: true } }, mediaAsset: true, channel: { select: { id: true, name: true } }, story: { include: { channel: { select: { id: true, name: true, language: true } }, post: { select: { id: true, platform: true, title: true, body: true, authorAlias: true, comments: { select: { id: true, body: true } } } }, versions: { orderBy: { version: 'desc' }, take: 20, include: { audioAssets: { include: { mediaAsset: { select: { id: true, mimeType: true } } } }, subtitleTracks: true } } } }, renderJob: true } });
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
    if (['BACKGROUND', 'MUSIC'].includes(asset.kind) && !validBackgroundRights(asset)) return notFound();
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
        if (!video.story || ['BLOCKED_RIGHTS', 'CANCELLED'].includes(video.status) || video.reviewStatus === 'BLOCKED') return false;
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
    } else if (asset.kind === 'SOURCE_CAPTURE') {
      const metadata = sourceImageMetadataSchema.safeParse(asset.metadata);
      if (!metadata.success || !await this.db.sourcePost.findFirst({ where: { id: metadata.data.postId, workspaceId: context.workspaceId, deletedAt: null } })) return notFound();
    } else if (!['BACKGROUND', 'MUSIC'].includes(asset.kind)) return notFound();
    const bytes = await objectStore().get(context.workspaceId, asset.checksum);
    const safeName = asset.kind === 'VIDEO' ? 'short-video.mp4' : asset.kind === 'BACKGROUND' ? (asset.mimeType === 'video/mp4' ? 'background.mp4' : 'background.webp') : asset.kind === 'MUSIC' ? 'music.wav' : asset.kind === 'AUDIO' ? 'narration.wav' : 'source.png';
    response.status(200);
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', bytes.byteLength);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${safeName}"`);
    if (!download && /^(audio|video)\//.test(asset.mimeType)) {
      response.setHeader('Accept-Ranges', 'bytes');
      const range = request.header('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match?.[2]));
        const end = match?.[1] && match[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1;
        if (!match || (!match[1] && (!match[2] || Number(match[2]) <= 0)) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.length) {
          response.status(416).setHeader('Content-Range', `bytes */${bytes.length}`); response.removeHeader('Content-Length'); response.end(); return;
        }
        response.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
        response.setHeader('Content-Length', end - start + 1); response.end(bytes.subarray(start, end + 1)); return;
      }
    }
    response.end(bytes);
  }

  private async buildInput(workspaceId: string, raw: unknown): Promise<ProductionInput> {
    const input = productionInputSchema.parse(raw);
    await this.assertPresentationAssets(workspaceId, input);
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
    await this.assertPresentationAssets(context.workspaceId, input, tx);
    const story = await tx.storyProject.findFirst({ where: { id: storyProjectId, workspaceId: context.workspaceId }, include: { post: { include: { comments: true } } } });
    if (!story || story.post.deletedAt) return notFound();
    const provenance = story.post.rawPayload;
    if (provenance && typeof provenance === 'object' && !Array.isArray(provenance) && typeof provenance.captureRunId === 'string') {
      const assets = await tx.mediaAsset.findMany({ where: { workspaceId: context.workspaceId, kind: 'SOURCE_CAPTURE', metadata: { path: ['postId'], equals: story.post.id } } });
      const sources = new Map<string, string>([[`post:${story.post.id}`, story.post.body], ...story.post.comments.filter(comment => input.commentIds.includes(comment.id)).map<[string, string]>(comment => [`comment:${comment.id}`, comment.body])]);
      const sourceImages: NonNullable<ProductionInput['sourceImages']> = [];
      for (const [ref, text] of sources) {
        const matches = assets.flatMap(asset => {
          const parsed = sourceImageMetadataSchema.safeParse(asset.metadata);
          return parsed.success && parsed.data.captureRunId === provenance.captureRunId && parsed.data.sourceRef === ref && parsed.data.variant === (input.anonymizeAuthors ? 'ANONYMIZED' : 'ORIGINAL') && parsed.data.textHash === createHash('sha256').update(text!).digest('hex') ? [{ asset, metadata: parsed.data }] : [];
        });
        if (matches.length !== 1) throw new ApiError(409, input.anonymizeAuthors ? 'SOURCE_IMAGE_ANONYMIZATION_REQUIRED' : 'SOURCE_IMAGE_MISSING', 'Thiếu ảnh nguồn khớp nội dung hoặc ảnh đã che tên/avatar. Kiểm tra ảnh chụp; có thể tắt che tác giả sau khi tự kiểm tra quyền và dữ liệu riêng tư.');
        const { asset, metadata } = matches[0]!;
        sourceImages.push({ assetId: asset.id, checksum: asset.checksum, sourceRef: ref!, width: metadata.width, height: metadata.height, anonymized: metadata.variant === 'ANONYMIZED' });
      }
      input = productionInputSchema.parse({ ...input, sourceImages });
      assertSourceImageBindings(input, story.post.id);
    }
    const run = await tx.productionRun.create({ data: {
      workspaceId: context.workspaceId, storyProjectId, requestedById: context.userId, idempotencyKey: `${route}:${randomKey()}`,
      status: 'QUEUED', currentStage: ['CREATE', 'REGENERATE', 'SCRIPT_ONLY'].includes(input.mode) ? 'SCRIPT_GENERATION' : 'TTS_GENERATION', input: input as unknown as Prisma.InputJsonObject,
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
