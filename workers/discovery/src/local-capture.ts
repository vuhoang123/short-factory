import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Prisma, type PrismaClient } from '@shorts-factory/database';
import { hashPostContent, normalizeText, redactPersonalData } from '@shorts-factory/shared';
import { captureInputSchema, capturedPostSchema, localCaptureCall, detectSensitiveFlags } from '@shorts-factory/sources';
import { LocalObjectStore, prepareSourceImage } from '@shorts-factory/media';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const clean = (value: string) => redactPersonalData(normalizeText(value));
const roles = ['OWNER', 'ADMIN', 'EDITOR'];

export async function processLocalCapture(db: PrismaClient, workspaceId: string, id: string) {
  const now = new Date();
  const run = await db.$transaction(async tx => {
    const current = await tx.workflowRun.findFirst({ where: { id, workspaceId, entityType: 'LOCAL_CAPTURE' } });
    if (!current || !['QUEUED', 'RUNNING'].includes(current.status) || (current.leaseUntil && current.leaseUntil > now)) return null;
    const input = captureInputSchema.parse(current.input);
    const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: input.requestedById } } });
    if (!member || !roles.includes(member.role) || current.attempts >= 3) {
      await tx.workflowRun.updateMany({ where: { id, workspaceId, version: current.version }, data: { status: 'FAILED', errorCode: 'CAPTURE_NOT_AUTHORIZED_OR_EXHAUSTED', leaseUntil: null } });
      await tx.outboxEvent.create({ data: { workspaceId, aggregateId: id, eventType: 'LOCAL_CAPTURE_PURGE_REQUESTED', payload: { workspaceId, userId: input.requestedById, jobId: id } } });
      return null;
    }
    const changed = await tx.workflowRun.updateMany({ where: { id, workspaceId, version: current.version }, data: { status: 'RUNNING', attempts: { increment: 1 }, version: { increment: 1 }, leaseUntil: new Date(now.getTime() + 90_000) } });
    return changed.count ? { ...current, version: current.version + 1, input } : null;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!run) return;
  const scope = { workspaceId, userId: run.input.requestedById, jobId: id };
  const deadline = Date.now() + 270_000;
  let lost = false;
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void db.workflowRun.updateMany({ where: { id, workspaceId, version: run.version, status: 'RUNNING', leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 90_000) } }).then(result => { lost ||= !result.count; }).catch(() => { lost = true; }).finally(() => { renewing = false; });
  }, 20_000);
  const store = new LocalObjectStore(path.resolve(process.env.STORAGE_LOCAL_ROOT ?? '.data/objects'));
  const stagedObjects = new Map<string, string>();
  try {
    const post = capturedPostSchema.parse(await (await localCaptureCall('capture', { ...scope, url: run.input.url })).json());
    if (!post.source_image_id) throw new Error('SOURCE_POST_IMAGE_MISSING');
    if (lost) throw new Error('CAPTURE_LEASE_LOST');
    const entries = [{ text: post.text, author: post.author, source_image_id: post.source_image_id, anonymous_image_id: post.anonymous_image_id }, ...post.comments];
    const prepared: Array<{ checksum: string; storageKey: string; width: number; height: number; variant: 'ORIGINAL' | 'ANONYMIZED'; externalId: string | null; textHash: string }> = [];
    for (const [index, entry] of entries.entries()) {
      if (lost) throw new Error('CAPTURE_LEASE_LOST');
      if (Date.now() > deadline) throw new Error('CAPTURE_TIMEOUT');
      const externalId = index === 0 ? null : digest(`${entry.author}\n${normalizeText(entry.text)}`);
      for (const [variant, imageId] of [['ORIGINAL', entry.source_image_id], ['ANONYMIZED', entry.anonymous_image_id]] as const) {
        if (!imageId) continue;
        const response = await localCaptureCall('image', { ...scope, imageId }, 15_000);
        if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw new Error('SOURCE_IMAGE_SIZE_INVALID');
        const image = await prepareSourceImage(new Uint8Array(await response.arrayBuffer()), digest(`${id}:${externalId}:${variant}`));
        const object = await store.put(workspaceId, image.bytes);
        stagedObjects.set(object.checksum, object.storageKey);
        prepared.push({ ...object, width: image.width, height: image.height, variant, externalId, textHash: digest(clean(entry.text)) });
      }
    }
    await db.$transaction(async tx => {
      const current = await tx.workflowRun.findFirst({ where: { id, workspaceId, version: run.version, status: 'RUNNING', leaseUntil: { gt: new Date() } } });
      const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: scope.userId } } });
      if (!current || lost || !member || !roles.includes(member.role)) throw new Error('CAPTURE_LEASE_LOST');
      if (!await tx.contentChannel.findFirst({ where: { id: run.input.channelId, workspaceId } })) throw new Error('CAPTURE_CHANNEL_MISSING');
      const platform = post.platform === 'facebook' ? 'FACEBOOK' : 'THREADS';
      const externalPostId = digest(post.url);
      const body = clean(post.text);
      const contentHash = hashPostContent(undefined, body);
      const duplicate = await tx.sourcePost.findFirst({ where: { workspaceId, platform, OR: [{ externalPostId }, { contentHash }] } });
      if (duplicate) throw new Error(duplicate.deletedAt ? 'CONTENT_TAKEN_DOWN' : 'SOURCE_ALREADY_CAPTURED');
      const source = await tx.sourcePost.create({ data: { workspaceId, channelId: run.input.channelId, platform, externalPostId, canonicalUrl: post.url, body, contentHash, sensitiveFlags: detectSensitiveFlags(post.text), rawPayload: { captureRunId: id } } });
      const refs = new Map<string | null, string>([[null, `post:${source.id}`]]);
      for (const entry of post.comments) {
        const externalId = digest(`${entry.author}\n${normalizeText(entry.text)}`);
        if (refs.has(externalId)) continue;
        const comment = await tx.sourceComment.create({ data: { workspaceId, sourcePostId: source.id, externalId, body: clean(entry.text), likes: entry.reaction_count != null && entry.reaction_count <= 2147483647 ? entry.reaction_count : null, sensitiveFlags: detectSensitiveFlags(entry.text) } });
        refs.set(externalId, `comment:${comment.id}`);
      }
      for (const image of prepared) {
        const metadata = { postId: source.id, captureRunId: id, sourceRef: refs.get(image.externalId)!, variant: image.variant, textHash: image.textHash, width: image.width, height: image.height };
        const existing = await tx.mediaAsset.findFirst({ where: { workspaceId, storageKey: image.storageKey } });
        if (existing) throw new Error('SOURCE_IMAGE_IDENTITY_CONFLICT');
        await tx.mediaAsset.create({ data: { workspaceId, kind: 'SOURCE_CAPTURE', storageKey: image.storageKey, checksum: image.checksum, mimeType: 'image/png', metadata } });
      }
      await tx.contentRight.create({ data: { workspaceId, sourcePostId: source.id, basis: 'UNKNOWN', reviewStatus: 'PENDING' } });
      await tx.workflowRun.updateMany({ where: { id, workspaceId, version: run.version }, data: { status: 'SUCCEEDED', entityId: source.id, leaseUntil: null, output: { postId: source.id, warnings: post.warnings, scannedComments: post.comment_pool_size, capturedComments: post.comments.length } } });
      await tx.outboxEvent.createMany({ data: [{ workspaceId, aggregateId: source.id, eventType: 'SOURCE_POST_IMPORTED', payload: { version: 1 } }, { workspaceId, aggregateId: id, eventType: 'LOCAL_CAPTURE_PURGE_REQUESTED', payload: scope }] });
      await tx.auditLog.create({ data: { workspaceId, actorId: scope.userId, action: 'LOCAL_SOURCE_CAPTURED', resourceType: 'SourcePost', resourceId: source.id, metadata: { captureRunId: id, commentCount: post.comments.length } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message) ? error.message : 'LOCAL_CAPTURE_FAILED';
    const retryable = run.attempts + 1 < 3 && (code === 'LOCAL_CAPTURE_UNAVAILABLE' || error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code));
    await db.$transaction(async tx => {
      const changed = await tx.workflowRun.updateMany({ where: { id, workspaceId, version: run.version, status: 'RUNNING' }, data: { status: retryable ? 'QUEUED' : 'FAILED', leaseUntil: null, errorCode: code } });
      if (changed.count && !retryable) await tx.outboxEvent.create({ data: { workspaceId, aggregateId: id, eventType: 'LOCAL_CAPTURE_PURGE_REQUESTED', payload: scope } });
      const cancelled = changed.count ? false : Boolean(await tx.workflowRun.findFirst({ where: { id, workspaceId, status: 'CANCELLED' }, select: { id: true } }));
      if (changed.count || cancelled) for (const [checksum, storageKey] of stagedObjects) {
        if (!await tx.mediaAsset.findFirst({ where: { workspaceId, storageKey }, select: { id: true } })) {
          const entityId = randomUUID();
          await tx.outboxEvent.create({ data: { workspaceId, aggregateId: entityId, eventType: 'MEDIA_ASSET_DELETE_REQUESTED', payload: { entityId, workspaceId, checksum, storageKey } } });
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } finally { clearInterval(timer); }
}

/** PostgreSQL recovers both lost queue delivery and expired worker leases. */
export async function recoverLocalCaptures(db: PrismaClient) {
  const cutoff = new Date(Date.now() - 30_000);
  const runs = await db.workflowRun.findMany({ where: { entityType: 'LOCAL_CAPTURE', status: { in: ['QUEUED', 'RUNNING'] }, updatedAt: { lt: cutoff }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, take: 25 });
  for (const run of runs) await db.$transaction(async tx => {
    const changed = await tx.workflowRun.updateMany({ where: { id: run.id, workspaceId: run.workspaceId, version: run.version, status: run.status, leaseUntil: run.leaseUntil, updatedAt: run.updatedAt }, data: { status: run.attempts >= 3 ? 'FAILED' : 'QUEUED', version: { increment: 1 }, leaseUntil: null, ...(run.attempts >= 3 ? { errorCode: 'CAPTURE_RECOVERY_EXHAUSTED' } : {}) } });
    if (changed.count && run.attempts < 3) await tx.outboxEvent.create({ data: { workspaceId: run.workspaceId, aggregateId: run.id, eventType: 'BROWSER_CAPTURE_REQUESTED', payload: { version: run.version + 1 } } });
    if (changed.count && run.attempts >= 3) await tx.outboxEvent.create({ data: { workspaceId: run.workspaceId, aggregateId: run.id, eventType: 'LOCAL_CAPTURE_PURGE_REQUESTED', payload: { workspaceId: run.workspaceId, userId: captureInputSchema.parse(run.input).requestedById, jobId: run.id } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
