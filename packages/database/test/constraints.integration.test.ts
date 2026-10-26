import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/index.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for database integration tests.');
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const namespace = randomUUID();
const a = { workspaceId: randomUUID(), userId: randomUUID(), channelId: randomUUID(), sourceId: randomUUID(), postId: randomUUID(), assetId: randomUUID(), storyId: randomUUID(), videoId: randomUUID(), accountId: randomUUID(), publicationId: randomUUID() };
const b = { workspaceId: randomUUID(), userId: randomUUID(), channelId: randomUUID(), sourceId: randomUUID(), postId: randomUUID(), assetId: randomUUID(), storyId: randomUUID(), videoId: randomUUID(), accountId: randomUUID(), publicationId: randomUUID() };
const workspaceIds = [a.workspaceId, b.workspaceId];

beforeAll(async () => {
  for (const tenant of [a, b]) {
    await db.user.create({ data: { id: tenant.userId, email: `${tenant.userId}@db-test.invalid`, passwordHash: 'unusable-test-hash' } });
    await db.workspace.create({ data: { id: tenant.workspaceId, name: 'Constraint fixture', slug: `constraints-${tenant.workspaceId}`, members: { create: { userId: tenant.userId, role: 'OWNER' } } } });
    await db.contentChannel.create({ data: { id: tenant.channelId, workspaceId: tenant.workspaceId, name: 'Fixture', topicConfig: {}, automationConfig: {} } });
    await db.sourceConfig.create({ data: { id: tenant.sourceId, workspaceId: tenant.workspaceId, channelId: tenant.channelId, platform: 'MANUAL', sourceKey: 'fixture', config: {} } });
    await db.sourcePost.create({ data: { id: tenant.postId, workspaceId: tenant.workspaceId, sourceConfigId: tenant.sourceId, channelId: tenant.channelId, platform: 'MANUAL', externalPostId: 'same-external-id', canonicalUrl: 'https://example.org/owned', body: 'Own content', contentHash: 'same-content-hash' } });
    await db.mediaAsset.create({ data: { id: tenant.assetId, workspaceId: tenant.workspaceId, kind: 'EVIDENCE', storageKey: 'fixture-evidence', checksum: namespace, mimeType: 'text/plain' } });
    await db.storyProject.create({ data: { id: tenant.storyId, workspaceId: tenant.workspaceId, sourcePostId: tenant.postId } });
    await db.video.create({ data: { id: tenant.videoId, workspaceId: tenant.workspaceId, channelId: tenant.channelId, storyProjectId: tenant.storyId, mediaAssetId: tenant.assetId, title: 'Fixture' } });
    await db.socialAccount.create({ data: { id: tenant.accountId, workspaceId: tenant.workspaceId, platform: 'YOUTUBE', externalId: 'fixture-account', displayName: 'Disconnected fixture' } });
    await db.publication.create({ data: { id: tenant.publicationId, workspaceId: tenant.workspaceId, videoId: tenant.videoId, socialAccountId: tenant.accountId, idempotencyKey: randomUUID() } });
  }
}, 30_000);

afterAll(async () => {
  const where = { workspaceId: { in: workspaceIds } };
  await db.session.deleteMany({ where: { userId: { in: [a.userId, b.userId] } } });
  await db.publicationAttempt.deleteMany({ where });
  await db.publicationMetric.deleteMany({ where });
  await db.publication.deleteMany({ where });
  await db.video.deleteMany({ where });
  await db.storyVersion.deleteMany({ where });
  await db.storyProject.deleteMany({ where });
  await db.idempotencyRecord.deleteMany({ where });
  await db.auditLog.deleteMany({ where });
  await db.contentRight.deleteMany({ where });
  await db.contentCandidate.deleteMany({ where });
  await db.postMetricSnapshot.deleteMany({ where });
  await db.sourceComment.deleteMany({ where });
  await db.sourcePost.deleteMany({ where });
  await db.sourceSyncRun.deleteMany({ where });
  await db.sourceConfig.deleteMany({ where });
  await db.mediaAsset.deleteMany({ where });
  await db.contentChannel.deleteMany({ where });
  await db.outboxEvent.deleteMany({ where });
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.user.deleteMany({ where: { id: { in: [a.userId, b.userId] } } });
  await db.$disconnect();
}, 30_000);

describe('PostgreSQL tenant ownership constraints', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['source channel', () => db.sourceConfig.create({ data: { workspaceId: a.workspaceId, channelId: b.channelId, platform: 'MANUAL', sourceKey: randomUUID(), config: {} } })],
    ['post channel', () => db.sourcePost.create({ data: { workspaceId: a.workspaceId, channelId: b.channelId, platform: 'MANUAL', externalPostId: randomUUID(), contentHash: randomUUID(), canonicalUrl: 'https://example.org', body: 'Fixture' } })],
    ['post source', () => db.sourcePost.create({ data: { workspaceId: a.workspaceId, sourceConfigId: b.sourceId, platform: 'MANUAL', externalPostId: randomUUID(), contentHash: randomUUID(), canonicalUrl: 'https://example.org', body: 'Fixture' } })],
    ['comment post', () => db.sourceComment.create({ data: { workspaceId: a.workspaceId, sourcePostId: b.postId, externalId: randomUUID(), body: 'Fixture' } })],
    ['metrics post', () => db.postMetricSnapshot.create({ data: { workspaceId: a.workspaceId, sourcePostId: b.postId } })],
    ['candidate post', () => db.contentCandidate.create({ data: { workspaceId: a.workspaceId, sourcePostId: b.postId } })],
    ['rights post', () => db.contentRight.create({ data: { workspaceId: a.workspaceId, sourcePostId: b.postId, allowedPlatforms: [] } })],
    ['rights reviewer', () => db.contentRight.create({ data: { workspaceId: a.workspaceId, sourcePostId: a.postId, reviewedById: b.userId, allowedPlatforms: [] } })],
    ['rights evidence', () => db.contentRight.create({ data: { workspaceId: a.workspaceId, sourcePostId: a.postId, evidenceAssetId: b.assetId, allowedPlatforms: [] } })],
    ['sync source', () => db.sourceSyncRun.create({ data: { workspaceId: a.workspaceId, sourceConfigId: b.sourceId, status: 'PENDING' } })],
    ['story post', () => db.storyProject.create({ data: { workspaceId: a.workspaceId, sourcePostId: b.postId } })],
    ['story version', () => db.storyVersion.create({ data: { workspaceId: a.workspaceId, storyProjectId: b.storyId, version: 1, script: {} } })],
    ['video channel', () => db.video.create({ data: { workspaceId: a.workspaceId, channelId: b.channelId, title: 'Fixture' } })],
    ['video story', () => db.video.create({ data: { workspaceId: a.workspaceId, channelId: a.channelId, storyProjectId: b.storyId, title: 'Fixture' } })],
    ['video media', () => db.video.create({ data: { workspaceId: a.workspaceId, channelId: a.channelId, mediaAssetId: b.assetId, title: 'Fixture' } })],
    ['publication video', () => db.publication.create({ data: { workspaceId: a.workspaceId, videoId: b.videoId, socialAccountId: a.accountId, idempotencyKey: randomUUID() } })],
    ['publication account', () => db.publication.create({ data: { workspaceId: a.workspaceId, videoId: a.videoId, socialAccountId: b.accountId, idempotencyKey: randomUUID() } })],
    ['publication attempt', () => db.publicationAttempt.create({ data: { workspaceId: a.workspaceId, publicationId: b.publicationId, attemptNo: 1, stage: 'FIXTURE' } })],
    ['publication metric', () => db.publicationMetric.create({ data: { workspaceId: a.workspaceId, publicationId: b.publicationId, metrics: {} } })],
    ['audit actor', () => db.auditLog.create({ data: { workspaceId: a.workspaceId, actorId: b.userId, action: 'FIXTURE', resourceType: 'Post', resourceId: a.postId } })],
    ['idempotency member', () => db.idempotencyRecord.create({ data: { workspaceId: a.workspaceId, userId: b.userId, route: 'fixture', key: randomUUID(), requestHash: namespace, response: {}, statusCode: 201 } })],
    ['session active membership', () => db.session.create({ data: { userId: a.userId, activeWorkspaceId: b.workspaceId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } })],
  ];

  test.each(cases)('rejects a cross-workspace %s relation', async (_name, create) => {
    await expect(create()).rejects.toMatchObject({ code: 'P2003' });
  });

  test('allows the same external ID and hash in separate workspaces but dedupes inside one', async () => {
    expect(await db.sourcePost.count({ where: { workspaceId: { in: workspaceIds }, externalPostId: 'same-external-id' } })).toBe(2);
    await expect(db.sourcePost.create({ data: { workspaceId: a.workspaceId, platform: 'MANUAL', externalPostId: randomUUID(), contentHash: 'same-content-hash', canonicalUrl: 'https://example.org/new-url', body: 'Own content' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.sourcePost.create({ data: { workspaceId: a.workspaceId, platform: 'MANUAL', externalPostId: 'same-external-id', contentHash: randomUUID(), canonicalUrl: 'https://example.org/new-url', body: 'Changed content' } })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('defaults content rights to pending, unattested and unknown', async () => {
    const right = await db.contentRight.create({ data: { workspaceId: a.workspaceId, sourcePostId: a.postId, allowedPlatforms: [] } });
    expect(right).toMatchObject({ basis: 'UNKNOWN', reviewStatus: 'PENDING', attested: false, commercialAllowed: false, territory: 'UNSPECIFIED' });
  });

  test('rolls back state and its outbox event together', async () => {
    const channelId = randomUUID();
    const eventId = randomUUID();
    await expect(db.$transaction(async (tx) => {
      await tx.contentChannel.create({ data: { id: channelId, workspaceId: a.workspaceId, name: 'Must roll back', topicConfig: {}, automationConfig: {} } });
      await tx.outboxEvent.create({ data: { id: eventId, workspaceId: a.workspaceId, eventType: 'TEST_ONLY', aggregateId: channelId, payload: { entityId: channelId } } });
      throw new Error('Injected failure before commit');
    })).rejects.toThrow('Injected failure before commit');
    expect(await db.contentChannel.findUnique({ where: { id: channelId } })).toBeNull();
    expect(await db.outboxEvent.findUnique({ where: { id: eventId } })).toBeNull();
  });

  test('commits state and ID-only outbox together', async () => {
    const channelId = randomUUID();
    const eventId = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.contentChannel.create({ data: { id: channelId, workspaceId: a.workspaceId, name: 'Committed fixture', topicConfig: {}, automationConfig: {} } });
      await tx.outboxEvent.create({ data: { id: eventId, workspaceId: a.workspaceId, eventType: 'TEST_ONLY', aggregateId: channelId, payload: { entityId: channelId } } });
    });
    expect(await db.contentChannel.findUnique({ where: { workspaceId_id: { workspaceId: a.workspaceId, id: channelId } } })).not.toBeNull();
    expect(await db.outboxEvent.findUnique({ where: { id: eventId } })).toMatchObject({ workspaceId: a.workspaceId, payload: { entityId: channelId }, publishedAt: null });
  });
});
