import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@shorts-factory/database';
import { createApp } from '../src/app.js';
import fixture from '../../../examples/manual-import.json';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Integration tests require a dedicated database ending in _test.');
const integration = testUrl ? describe.sequential : describe.skip;
const origin = process.env.APP_URL ?? 'http://localhost:3000';
const prefix = '/api/v1';
type Agent = ReturnType<typeof supertest.agent>;
const namespace = randomUUID().slice(0, 8);

integration('Phase 2 PostgreSQL discovery and rights vertical slice', () => {
  let app: INestApplication;
  let server: Server;
  let db: PrismaClient;
  let ownerA: Agent;
  let ownerB: Agent;
  let reviewer: Agent;
  let viewer: Agent;
  let editor: Agent;
  let workspaceA = '';
  let workspaceB = '';
  let postId = '';
  let unknownPostId = '';
  let channelB = '';
  const userIds: string[] = [];

  function post(agent: Agent, path: string, body: object, key = randomUUID()) {
    return agent.post(`${prefix}${path}`).set('Origin', origin).set('Idempotency-Key', key).send(body);
  }

  async function register(label: string) {
    const agent = supertest.agent(server);
    const response = await post(agent, '/auth/register', { email: `${namespace}-${label}@example.org`, password: 'a strong local test password', name: label });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id as string);
    return agent;
  }

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: testUrl });
    app = await createApp(db);
    server = app.getHttpServer() as Server;
    ownerA = await register('owner-a');
    ownerB = await register('owner-b');
    reviewer = await register('reviewer');
    viewer = await register('viewer');
    editor = await register('editor');
    const a = await post(ownerA, '/workspaces', { name: 'Workspace A', slug: `${namespace}-workspace-a` });
    const b = await post(ownerB, '/workspaces', { name: 'Workspace B', slug: `${namespace}-workspace-b` });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    workspaceA = a.body.id as string;
    workspaceB = b.body.id as string;
    for (const [label, agent, role] of [['reviewer', reviewer, 'REVIEWER'], ['viewer', viewer, 'VIEWER'], ['editor', editor, 'EDITOR']] as const) {
      expect((await post(ownerA, `/workspaces/${workspaceA}/members`, { email: `${namespace}-${label}@example.org`, role })).status).toBe(201);
      expect((await post(agent, '/auth/workspace', { workspaceId: workspaceA })).status).toBe(201);
    }
    const channel = await post(ownerB, '/channels', { name: 'B private channel' });
    expect(channel.status).toBe(201);
    channelB = channel.body.id as string;
  });

  afterAll(async () => {
    if (db) {
      const scope = { workspaceId: { in: [workspaceA, workspaceB].filter(Boolean) } };
      await db.$transaction([
        db.idempotencyRecord.deleteMany({ where: scope }), db.auditLog.deleteMany({ where: scope }),
        db.session.deleteMany({ where: { userId: { in: userIds } } }),
        db.publicationMetric.deleteMany({ where: scope }), db.publicationAttempt.deleteMany({ where: scope }), db.publication.deleteMany({ where: scope }),
        db.video.deleteMany({ where: scope }), db.storyVersion.deleteMany({ where: scope }), db.storyProject.deleteMany({ where: scope }),
        db.contentRight.deleteMany({ where: scope }), db.sourceComment.deleteMany({ where: scope }), db.postMetricSnapshot.deleteMany({ where: scope }), db.contentCandidate.deleteMany({ where: scope }), db.sourcePost.deleteMany({ where: scope }),
        db.sourceSyncRun.deleteMany({ where: scope }), db.sourceConfig.deleteMany({ where: scope }), db.topicRule.deleteMany({ where: scope }), db.contentChannel.deleteMany({ where: scope }), db.mediaAsset.deleteMany({ where: scope }),
        db.workflowRun.deleteMany({ where: scope }), db.outboxEvent.deleteMany({ where: scope }), db.socialAccount.deleteMany({ where: scope }),
        db.workspaceMember.deleteMany({ where: scope }), db.workspace.deleteMany({ where: { id: scope.workspaceId } }), db.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
      await db.$disconnect();
    }
    if (app) await app.close();
  });

  it('exposes credential-free health and rejects anonymous content access', async () => {
    expect((await supertest(server).get(`${prefix}/health`)).body.status).toBe('ok');
    const denied = await supertest(server).get(`${prefix}/posts`);
    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe('UNAUTHENTICATED');
    expect(denied.body.requestId).toBeTruthy();
  });

  it('stores password/session digests, sets safe cookies, and never trusts client-selected tenants', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: `${namespace}-owner-a@example.org` } });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const signedIn = await post(supertest.agent(server), '/auth/login', { email: user.email, password: 'a strong local test password' });
    expect(signedIn.status).toBe(201);
    expect(String(signedIn.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(signedIn.headers['set-cookie'])).toContain('SameSite=Lax');
    expect(JSON.stringify(signedIn.body)).not.toContain('passwordHash');
    expect((await ownerA.get(`${prefix}/workspaces/${workspaceB}`)).status).toBe(404);
    expect((await post(ownerA, '/auth/workspace', { workspaceId: workspaceB })).status).toBe(403);
    expect((await post(ownerA, '/channels', { name: 'Attack', workspaceId: workspaceB })).status).toBe(403);
    const context = await ownerA.get(`${prefix}/auth/me`).set('X-Workspace-ID', workspaceB);
    expect(context.body.activeWorkspaceId).toBe(workspaceA);
  });

  it('makes first-workspace creation replay-safe and detects idempotency-key conflicts', async () => {
    const key = randomUUID();
    const body = { name: 'Second A workspace', slug: `${namespace}-workspace-a-second` };
    const first = await post(ownerA, '/workspaces', body, key);
    const replay = await post(ownerA, '/workspaces', body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    const conflict = await post(ownerA, '/workspaces', { ...body, name: 'Changed name' }, key);
    expect(conflict.status).toBe(409);
    const extra = first.body.id as string;
    await db.idempotencyRecord.deleteMany({ where: { workspaceId: extra } });
    await db.auditLog.deleteMany({ where: { workspaceId: extra } });
    await db.session.updateMany({ where: { activeWorkspaceId: extra }, data: { activeWorkspaceId: workspaceA } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: extra } });
    await db.workspace.delete({ where: { id: extra } });
  });

  it('enforces role boundaries, validates links, and keeps unapproved sources externally blocked', async () => {
    expect((await post(viewer, '/channels', { name: 'Forbidden' })).status).toBe(403);
    expect((await post(editor, '/channels', { name: 'Forbidden' })).status).toBe(403);
    expect((await viewer.get(`${prefix}/audit-logs`)).status).toBe(403);
    expect((await post(ownerA, '/sources', { platform: 'MANUAL', sourceKey: 'cross-workspace', channelId: channelB })).status).toBe(404);
    const blocked = await post(ownerA, '/sources', { platform: 'FACEBOOK', sourceKey: 'approved-api-required', enabled: true });
    expect(blocked.status).toBe(201);
    expect(blocked.body).toMatchObject({ enabled: false, capabilityStatus: 'BLOCKED_EXTERNAL' });
    expect((await ownerB.get(`${prefix}/sources`)).body.items).toEqual([]);
  });

  it('manages sources and topic rules with tenant isolation and atomic idempotent sync enqueue', async () => {
    const channel = await post(ownerA, '/channels', { name: 'Demo discovery channel', language: 'en', minimumCandidateScore: 60 });
    expect(channel.status).toBe(201);
    const created = await post(ownerA, '/sources', { platform: 'MANUAL', sourceKey: `${namespace}-demo`, channelId: channel.body.id, enabled: true, syncFrequencyMinutes: 720, config: { mode: 'MOCK_FIXTURE', keywords: [], hashtags: [], topics: [], language: 'en' } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ enabled: true, capabilityStatus: 'AVAILABLE', syncFrequencyMinutes: 720 });
    const sourceId = created.body.id as string;
    expect((await post(ownerA, `/sources/${sourceId}/verify`, {})).body).toMatchObject({ available: true, status: 'AVAILABLE' });
    const key = randomUUID();
    const firstSync = await post(ownerA, `/sources/${sourceId}/sync`, {}, key);
    const replay = await post(ownerA, `/sources/${sourceId}/sync`, {}, key);
    expect(firstSync.status).toBe(201);
    expect(replay.body).toEqual(firstSync.body);
    expect(firstSync.body.status).toBe('QUEUED');
    expect(await db.sourceSyncRun.count({ where: { workspaceId: workspaceA, sourceConfigId: sourceId } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { workspaceId: workspaceA, eventType: 'SOURCE_SYNC_REQUESTED', aggregateId: firstSync.body.runId as string } })).toBe(1);
    expect((await ownerB.get(`${prefix}/sources/${sourceId}/sync-runs`)).status).toBe(404);
    expect((await ownerB.patch(`${prefix}/sources/${sourceId}`).set('Origin', origin).set('Idempotency-Key', randomUUID()).send({ sourceKey: 'tenant-attack' })).status).toBe(404);
    expect((await ownerB.get(`${prefix}/sources`)).body.items).toEqual([]);

    const invalidRule = await post(ownerA, '/topic-rules', { channelId: channelB, name: 'cross tenant rule' });
    expect(invalidRule.status).toBe(404);
    const rule = await post(ownerA, '/topic-rules', { channelId: channel.body.id, name: 'Local stories', keywords: ['community'], deny: ['advertisement'], minimumScore: 65 });
    expect(rule.status).toBe(201);
    const rules = await ownerA.get(`${prefix}/topic-rules`);
    expect(rules.body.items.map((item: { id: string }) => item.id)).toContain(rule.body.id);
    expect((await ownerB.get(`${prefix}/topic-rules`)).body.items).toEqual([]);
    expect((await ownerB.patch(`${prefix}/topic-rules/${rule.body.id}`).set('Origin', origin).set('Idempotency-Key', randomUUID()).send({ enabled: false })).status).toBe(404);
    expect((await ownerA.delete(`${prefix}/topic-rules/${rule.body.id}`).set('Origin', origin).set('Idempotency-Key', randomUUID())).status).toBe(200);

    const external = await post(ownerA, '/sources', { platform: 'REDDIT', sourceKey: `${namespace}-reddit`, enabled: true });
    expect(external.body.enabled).toBe(false);
    expect((await post(ownerA, `/sources/${external.body.id}/verify`, {})).body).toMatchObject({ available: false, status: 'NOT_CONFIGURED' });
    const edit = await ownerA.patch(`${prefix}/sources/${sourceId}`).set('Origin', origin).set('Idempotency-Key', randomUUID()).send({ sourceKey: `${namespace}-renamed`, enabled: false });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ sourceKey: `${namespace}-renamed`, enabled: false });
    expect((await ownerA.delete(`${prefix}/sources/${sourceId}`).set('Origin', origin).set('Idempotency-Key', randomUUID())).status).toBe(200);
  });

  it('imports a permitted post plus three comments atomically, records audit/outbox IDs, and holds rights for review', async () => {
    const response = await post(editor, '/imports/manual', { ...fixture, externalPostId: `${namespace}-owned`, rights: { ...fixture.rights, territory: 'WORLDWIDE', evidence: 'I created this text and all three example comments.' } });
    expect(response.status).toBe(201);
    expect(response.body.deduplicated).toBe(false);
    postId = response.body.postId as string;
    const detail = await ownerA.get(`${prefix}/posts/${postId}`);
    expect(detail.body._count.comments).toBe(3);
    expect(detail.body.rights[0].reviewStatus).toBe('PENDING');
    const comments = await viewer.get(`${prefix}/posts/${postId}/comments`);
    expect(comments.body.items).toHaveLength(3);
    const eligibility = await ownerA.get(`${prefix}/posts/${postId}/eligibility?platform=YOUTUBE`);
    expect(eligibility.body.allowed).toBe(false);
    expect(eligibility.body.reasons).toContain('REVIEW_REQUIRED');
    const events = await db.outboxEvent.findMany({ where: { workspaceId: workspaceA, aggregateId: postId } });
    expect(events).toHaveLength(1);
    expect(events[0]?.publishedAt).toBeNull();
    expect(events[0]?.payload).toEqual({ entityId: postId, workspaceId: workspaceA, version: 1 });
    expect(JSON.stringify(events)).not.toContain(fixture.body);
    expect(await db.auditLog.count({ where: { workspaceId: workspaceA, resourceId: postId, action: 'MANUAL_IMPORTED' } })).toBe(1);
    await db.contentCandidate.create({ data: { workspaceId: workspaceA, sourcePostId: postId, score: 77, minimumScore: 55, status: 'NEEDS_RIGHTS_REVIEW' } });
  });

  it('lists and reviews candidates only inside their workspace', async () => {
    const list = await ownerA.get(`${prefix}/candidates?rightsStatus=PENDING&minScore=50`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const candidateId = list.body.items[0].id as string;
    expect((await ownerB.get(`${prefix}/candidates`)).body.items).toEqual([]);
    expect((await post(ownerB, `/candidates/${candidateId}/review`, { decision: 'REJECTED' })).status).toBe(404);
  });

  it('deduplicates hashes/external IDs and replay, including concurrent delivery, without upgrading rights', async () => {
    const body = { ...fixture, externalPostId: `${namespace}-owned`, rights: { ...fixture.rights, territory: 'WORLDWIDE' } };
    const key = randomUUID();
    const [first, replay] = await Promise.all([post(editor, '/imports/manual', body, key), post(editor, '/imports/manual', body, key)]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(first.body.postId).toBe(postId);
    expect(first.body.deduplicated).toBe(true);
    const hashReplay = await post(editor, '/imports/manual', { ...body, externalPostId: `${namespace}-different-id` });
    expect(hashReplay.body.postId).toBe(postId);
    expect(await db.sourceComment.count({ where: { sourcePostId: postId, workspaceId: workspaceA } })).toBe(3);
    expect(await db.contentRight.count({ where: { sourcePostId: postId, workspaceId: workspaceA } })).toBe(1);
    expect((await post(editor, '/imports/manual', { ...body, body: 'Different text.' }, key)).status).toBe(409);
  });

  it('denies cross-workspace post/comment/rights reads and all links before writing anything', async () => {
    expect((await ownerB.get(`${prefix}/posts/${postId}`)).status).toBe(404);
    expect((await ownerB.get(`${prefix}/posts/${postId}/comments`)).status).toBe(404);
    expect((await ownerB.get(`${prefix}/posts/${postId}/eligibility`)).status).toBe(404);
    expect((await post(ownerB, `/posts/${postId}/rights/review`, { decision: 'APPROVED' })).status).toBe(404);
    expect((await ownerB.get(`${prefix}/posts?cursor=${postId}`)).status).toBe(404);
    expect((await ownerB.get(`${prefix}/posts`)).body.items).toEqual([]);
    const before = await db.sourcePost.count({ where: { workspaceId: workspaceA } });
    const invalid = await post(editor, '/imports/manual', { ...fixture, externalPostId: `${namespace}-invalid-link`, body: 'Unique body invalid link.', channelId: channelB });
    expect(invalid.status).toBe(404);
    expect(await db.sourcePost.count({ where: { workspaceId: workspaceA } })).toBe(before);
    expect(await db.outboxEvent.count({ where: { workspaceId: workspaceA, aggregateId: channelB } })).toBe(0);
  });

  it('accepts unknown rights into a hold but rejects approval and importer escalation', async () => {
    const unknown = { ...fixture, externalPostId: `${namespace}-unknown`, body: 'Unknown rights material for a held review.', rights: { basis: 'UNKNOWN', attested: false, commercialAllowed: false, allowedPlatforms: [] } };
    const response = await post(editor, '/imports/manual', unknown);
    expect(response.status).toBe(201);
    unknownPostId = response.body.postId as string;
    expect((await viewer.get(`${prefix}/posts/${unknownPostId}/eligibility`)).body.reasons).toContain('UNKNOWN_RIGHTS');
    const blocked = await post(reviewer, `/posts/${unknownPostId}/rights/review`, { decision: 'APPROVED', territory: 'WORLDWIDE', evidence: 'Public visibility alone is not permission.' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('BLOCKED_RIGHTS');
    const escalation = await post(editor, '/imports/manual', { ...unknown, rights: { ...fixture.rights, territory: 'WORLDWIDE' } });
    expect(escalation.body.deduplicated).toBe(true);
    expect((await db.contentRight.findFirstOrThrow({ where: { workspaceId: workspaceA, sourcePostId: unknownPostId } })).basis).toBe('UNKNOWN');
  });

  it('permits explicit reviewer approval and rejects invalid state transitions and unsupported destinations', async () => {
    expect((await post(editor, `/posts/${postId}/rights/review`, { decision: 'APPROVED' })).status).toBe(403);
    const key = randomUUID();
    const approved = await post(reviewer, `/posts/${postId}/rights/review`, { decision: 'APPROVED' }, key);
    expect(approved.status).toBe(201);
    expect((await post(reviewer, `/posts/${postId}/rights/review`, { decision: 'APPROVED' }, key)).body).toEqual(approved.body);
    expect((await ownerA.get(`${prefix}/posts/${postId}/eligibility?platform=YOUTUBE`)).body.allowed).toBe(true);
    const candidate = await db.contentCandidate.findFirstOrThrow({ where: { workspaceId: workspaceA, sourcePostId: postId } });
    expect(candidate.status).toBe('PENDING_REVIEW');
    expect((await post(reviewer, `/candidates/${candidate.id}/review`, { decision: 'APPROVED' })).body.status).toBe('APPROVED');
    expect((await ownerA.get(`${prefix}/posts/${postId}/eligibility?platform=TIKTOK`)).body.reasons).toContain('PLATFORM_NOT_ALLOWED');
    expect((await post(reviewer, `/posts/${postId}/rights/review`, { decision: 'REJECTED' })).status).toBe(409);
  });

  it('keeps direct publication API fail-closed for unknown and expired rights without persisting any publish job', async () => {
    const channel = await db.contentChannel.create({ data: { workspaceId: workspaceA, name: 'Guard test', topicConfig: {}, automationConfig: {} } });
    const story = await db.storyProject.create({ data: { workspaceId: workspaceA, sourcePostId: unknownPostId } });
    const video = await db.video.create({ data: { workspaceId: workspaceA, channelId: channel.id, storyProjectId: story.id, title: 'Guard fixture', status: 'APPROVED', reviewStatus: 'APPROVED' } });
    const account = await db.socialAccount.create({ data: { workspaceId: workspaceA, platform: 'YOUTUBE', externalId: `${namespace}-mock-account`, displayName: 'Not a connected production account' } });
    const request = { videoId: video.id, targets: [{ socialAccountId: account.id, scheduledAt: '2030-01-01T00:00:00Z', privacy: 'private' }] };
    const blocked = await post(editor, '/publications', request);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('BLOCKED_RIGHTS');
    await db.storyProject.update({ where: { id: story.id }, data: { sourcePostId: postId } });
    const rights = await db.contentRight.findFirstOrThrow({ where: { workspaceId: workspaceA, sourcePostId: postId } });
    await db.contentRight.update({ where: { id: rights.id }, data: { expiresAt: new Date('2000-01-01T00:00:00Z') } });
    const expired = await post(editor, '/publications', request);
    expect(expired.status).toBe(403);
    expect(expired.body.details.blockers).toContain('RIGHTS_EXPIRED');
    await db.contentRight.update({ where: { id: rights.id }, data: { expiresAt: null } });
    const phase = await post(editor, '/publications', request);
    expect(phase.status).toBe(501);
    expect(phase.body.code).toBe('BLOCKED_PHASE');
    expect(await db.publication.count({ where: { workspaceId: workspaceA } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { workspaceId: workspaceA, eventType: { contains: 'PUBLICATION' } } })).toBe(0);
  });

  it('requires supporting evidence for reviewer correction from unknown rights', async () => {
    const body = { decision: 'APPROVED', basis: 'OWNED', attested: true, commercialAllowed: true, allowedPlatforms: ['YOUTUBE'], territory: 'WORLDWIDE' };
    const noEvidence = await post(reviewer, `/posts/${unknownPostId}/rights/review`, body);
    expect(noEvidence.status).toBe(403);
    expect(noEvidence.body.details.blockers).toContain('EVIDENCE_REQUIRED');
    const approved = await post(reviewer, `/posts/${unknownPostId}/rights/review`, { ...body, evidence: 'The author supplied written ownership confirmation for this exact text.' });
    expect(approved.status).toBe(201);
    expect((await ownerA.get(`${prefix}/posts/${unknownPostId}/eligibility`)).body.allowed).toBe(true);
  });

  it('minimizes imported personal data and rejects invalid URLs/oversized requests before persistence', async () => {
    const body = { ...fixture, externalPostId: `${namespace}-private`, canonicalUrl: 'https://example.org/permitted?tracking=private', body: 'Contact test-person@example.org or +84 912 345 678 in a permitted demo.', comments: [{ externalId: 'p1', body: 'reply@example.org' }] };
    const response = await post(editor, '/imports/manual', body);
    expect(response.status).toBe(201);
    const stored = await db.sourcePost.findUniqueOrThrow({ where: { id: response.body.postId as string } });
    expect(stored.body).not.toContain('test-person@example.org');
    expect(stored.canonicalUrl).not.toContain('?');
    expect((await post(editor, '/imports/manual', { ...body, canonicalUrl: 'http://127.0.0.1/admin' })).status).toBe(400);
    const oversized = await post(editor, '/imports/manual', { ...body, body: 'x'.repeat(300000) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe('REQUEST_TOO_LARGE');
  });

  it('rejects cross-origin cookie mutations and missing idempotency headers', async () => {
    const csrf = await ownerA.post(`${prefix}/channels`).set('Origin', 'https://attacker.example').set('Idempotency-Key', randomUUID()).send({ name: 'blocked' });
    expect(csrf.status).toBe(403);
    expect(csrf.body.code).toBe('CSRF_REJECTED');
    expect((await ownerA.post(`${prefix}/channels`).set('Origin', origin).send({ name: 'missing key' })).status).toBe(400);
    expect((await ownerA.post(`${prefix}/channels`).set('Idempotency-Key', randomUUID()).send({ name: 'missing origin' })).status).toBe(403);
  });

  it('takedown revokes rights, removes private content/comments and prevents reimport', async () => {
    expect((await post(viewer, '/takedowns', { postId, reason: 'Author objection' })).status).toBe(403);
    const response = await post(ownerA, '/takedowns', { postId, reason: 'Author objection' });
    expect(response.status).toBe(201);
    expect(response.body.downstreamRemoteRemoval).toBe('NEEDS_ACTION');
    expect((await viewer.get(`${prefix}/posts/${postId}`)).status).toBe(404);
    expect((await viewer.get(`${prefix}/posts/${postId}/comments`)).status).toBe(404);
    const removed = await db.sourcePost.findUniqueOrThrow({ where: { id: postId } });
    expect(removed.body).toBe('[removed]');
    expect(removed.deletedAt).not.toBeNull();
    expect(await db.sourceComment.count({ where: { sourcePostId: postId } })).toBe(0);
    const right = await db.contentRight.findFirstOrThrow({ where: { sourcePostId: postId } });
    expect(right.reviewStatus).toBe('BLOCKED');
    expect(right.evidence).toBeNull();
    expect(right.revokedAt).not.toBeNull();
    const reimport = await post(editor, '/imports/manual', { ...fixture, externalPostId: `${namespace}-owned` });
    expect(reimport.status).toBe(409);
    expect(reimport.body.code).toBe('CONTENT_TAKEN_DOWN');
  });

  it('rejects untrusted bearer credentials, expired sessions and logged-out session cookies', async () => {
    const unauthenticated = await supertest(server).get(`${prefix}/posts`).set('Authorization', `Bearer ${randomUUID().replaceAll('-', '')}aaaaaaaaaaa`).set('X-Workspace-ID', workspaceA);
    expect(unauthenticated.status).toBe(401);
    const agent = await register('session-lifecycle');
    expect((await agent.get(`${prefix}/auth/me`)).status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email: `${namespace}-session-lifecycle@example.org` } });
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date('2000-01-01T00:00:00Z') } });
    expect((await agent.get(`${prefix}/auth/me`)).status).toBe(401);
    expect((await post(agent, '/auth/login', { email: user.email, password: 'a strong local test password' })).status).toBe(201);
    expect((await post(agent, '/auth/logout', {})).status).toBe(201);
    expect((await agent.get(`${prefix}/auth/me`)).status).toBe(401);
  });

  it('rechecks current membership roles on every request and protects owner membership', async () => {
    const membershipPath = `/workspaces/${workspaceA}/members`;
    expect((await post(ownerA, membershipPath, { email: `${namespace}-editor@example.org`, role: 'VIEWER' })).status).toBe(201);
    expect((await editor.get(`${prefix}/posts`)).status).toBe(200);
    const denied = await post(editor, '/imports/manual', { ...fixture, externalPostId: `${namespace}-new-denied` });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    const protectedOwner = await post(ownerA, membershipPath, { email: `${namespace}-owner-a@example.org`, role: 'VIEWER' });
    expect(protectedOwner.status).toBe(403);
    expect(protectedOwner.body.code).toBe('OWNER_PROTECTED');
    expect((await post(ownerA, membershipPath, { email: `${namespace}-editor@example.org`, role: 'EDITOR' })).status).toBe(201);
    const members = await ownerA.get(`${prefix}${membershipPath}`);
    expect(members.status).toBe(200);
    expect(members.body.items).toContainEqual(expect.objectContaining({ email: `${namespace}-editor@example.org`, role: 'EDITOR' }));
    expect((await viewer.get(`${prefix}${membershipPath}`)).status).toBe(403);
  });

  it('permits a reviewer to resolve unknown rights for a Facebook-only licensed scope', async () => {
    const imported = await post(editor, '/imports/manual', { ...fixture, externalPostId: `${namespace}-facebook-rights`, body: 'Distinct content licensed only for a permitted Facebook Page.', rights: { basis: 'UNKNOWN', attested: false } });
    expect(imported.status).toBe(201);
    const id = imported.body.postId as string;
    const corrected = await post(reviewer, `/posts/${id}/rights/review`, { decision: 'APPROVED', basis: 'LICENSED', attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], territory: 'VN', evidence: 'Written license for commercial reuse on our Facebook Page in Vietnam.' });
    expect(corrected.status).toBe(201);
    expect((await viewer.get(`${prefix}/posts/${id}/eligibility?platform=FACEBOOK`)).body.allowed).toBe(true);
    const youtube = await viewer.get(`${prefix}/posts/${id}/eligibility?platform=YOUTUBE`);
    expect(youtube.body.allowed).toBe(false);
    expect(youtube.body.reasons).toContain('PLATFORM_NOT_ALLOWED');
  });
});
