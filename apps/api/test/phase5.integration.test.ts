import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { PrismaClient } from '@shorts-factory/database';
import { createApp } from '../src/app.js';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Integration tests require a dedicated database ending in _test.');
const integration = testUrl ? describe.sequential : describe.skip;
const origin = process.env.APP_URL ?? 'http://localhost:3000';
const prefix = '/api/v1';
const namespace = `phase5-${randomUUID().slice(0, 8)}`;
type Agent = ReturnType<typeof supertest.agent>;

integration('Phase 5 PostgreSQL API workflow, controls and tenant isolation', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let server: Server;
  let ownerA: Agent;
  let ownerB: Agent;
  let workspaceA = '';
  let workspaceB = '';
  let channelA = '';
  let channelB = '';
  let voice = '';
  let runId = '';
  let publicationId = '';
  let sourcePostId = '';
  let videoId = '';
  const users: string[] = [];

  function post(agent: Agent, route: string, body: object, key = randomUUID()) { return agent.post(`${prefix}${route}`).set('Origin', origin).set('Idempotency-Key', key).send(body); }
  function put(agent: Agent, route: string, body: object, key = randomUUID()) { return agent.put(`${prefix}${route}`).set('Origin', origin).set('Idempotency-Key', key).send(body); }
  const config = (durationSec = 40) => ({ mode: 'SEMI_AUTO', voiceProfileId: voice, durationSec, estimatedRunCostUsd: 0.1, targetPlatforms: ['YOUTUBE'], requireApproval: true });

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: testUrl });
    app = await createApp(db);
    server = app.getHttpServer() as Server;
    const register = async (label: string) => {
      const agent = supertest.agent(server);
      const response = await post(agent, '/auth/register', { email: `${namespace}-${label}@example.org`, password: 'a strong phase five test password', name: label });
      expect(response.status).toBe(201);
      users.push(response.body.user.id as string);
      return agent;
    };
    ownerA = await register('owner-a'); ownerB = await register('owner-b');
    const a = await post(ownerA, '/workspaces', { name: `${namespace} A`, slug: `${namespace}-a` });
    const b = await post(ownerB, '/workspaces', { name: `${namespace} B`, slug: `${namespace}-b` });
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    workspaceA = a.body.id as string; workspaceB = b.body.id as string;
    const channelOne = await post(ownerA, '/channels', { name: `${namespace} channel A` });
    const channelTwo = await post(ownerB, '/channels', { name: `${namespace} channel B` });
    expect(channelOne.status).toBe(201); expect(channelTwo.status).toBe(201);
    channelA = channelOne.body.id as string; channelB = channelTwo.body.id as string;
    const voices = await ownerA.get(`${prefix}/voice-profiles`);
    expect(voices.status).toBe(200);
    voice = voices.body.items[0]?.id as string;
    expect(voice).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    if (db) {
      const scope = { workspaceId: { in: [workspaceA, workspaceB].filter(Boolean) } };
      await db.$transaction([
        db.idempotencyRecord.deleteMany({ where: scope }), db.auditLog.deleteMany({ where: scope }),
        db.analyticsSyncRun.deleteMany({ where: scope }), db.publicationMetric.deleteMany({ where: scope }), db.publicationAttempt.deleteMany({ where: scope }), db.publication.deleteMany({ where: scope }),
        db.experimentAssignment.deleteMany({ where: scope }), db.experiment.deleteMany({ where: scope }), db.performanceRecommendation.deleteMany({ where: scope }),
        db.contentQualityReport.deleteMany({ where: scope }), db.usageEvent.deleteMany({ where: scope }), db.budgetReservation.deleteMany({ where: scope }),
        db.candidateSelectionDecision.deleteMany({ where: scope }), db.workflowStep.deleteMany({ where: scope }),
        db.renderJob.deleteMany({ where: scope }), db.renderManifest.deleteMany({ where: scope }), db.video.deleteMany({ where: scope }),
        db.audioAsset.deleteMany({ where: scope }), db.subtitleTrack.deleteMany({ where: scope }), db.productionStage.deleteMany({ where: scope }), db.productionRun.deleteMany({ where: scope }),
        db.storyVersion.deleteMany({ where: scope }), db.storyProject.deleteMany({ where: scope }),
        db.automationRuleVersion.deleteMany({ where: scope }), db.automationRule.deleteMany({ where: scope }), db.budgetPolicy.deleteMany({ where: scope }),
        db.contentRight.deleteMany({ where: scope }), db.sourceComment.deleteMany({ where: scope }), db.postMetricSnapshot.deleteMany({ where: scope }), db.contentCandidate.deleteMany({ where: scope }), db.sourcePost.deleteMany({ where: scope }),
        db.sourceSyncRun.deleteMany({ where: scope }), db.sourceConfig.deleteMany({ where: scope }), db.topicRule.deleteMany({ where: scope }),
        db.workflowRun.deleteMany({ where: scope }), db.outboxEvent.deleteMany({ where: scope }), db.socialAccount.deleteMany({ where: scope }), db.contentChannel.deleteMany({ where: scope }), db.mediaAsset.deleteMany({ where: scope }),
        db.session.deleteMany({ where: { userId: { in: users } } }), db.workspaceMember.deleteMany({ where: scope }), db.workspace.deleteMany({ where: { id: scope.workspaceId } }), db.user.deleteMany({ where: { id: { in: users } } }),
      ]);
    }
    if (app) await app.close();
    else if (db) await db.$disconnect();
  }, 60_000);

  it('versions rules and freezes each idempotent run with one reservation and outbox event', async () => {
    const first = await put(ownerA, `/channels/${channelA}/automation`, { expectedVersion: 0, config: config() });
    expect(first.status).toBe(200); expect(first.body.version).toBe(1);
    expect((await post(ownerA, `/channels/${channelA}/automation/control`, { action: 'ENABLE' })).status).toBe(201);
    const key = randomUUID();
    const run = await post(ownerA, `/channels/${channelA}/automation/run`, {}, key);
    expect(run.status).toBe(201); runId = run.body.id as string;
    expect((await post(ownerA, `/channels/${channelA}/automation/run`, {}, key)).body).toEqual(run.body);
    expect(await db.workflowRun.count({ where: { id: runId, workspaceId: workspaceA } })).toBe(1);
    expect(await db.budgetReservation.count({ where: { workspaceId: workspaceA, workflowRunId: runId } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { workspaceId: workspaceA, aggregateId: runId, eventType: 'AUTOPILOT_RUN_REQUESTED' } })).toBe(1);
    const update = await put(ownerA, `/channels/${channelA}/automation`, { expectedVersion: 1, config: config(50) });
    expect(update.status).toBe(200); expect(update.body.version).toBe(2);
    expect(await db.automationRuleVersion.count({ where: { workspaceId: workspaceA, ruleId: first.body.id as string } })).toBe(2);
    const frozen = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    expect(frozen.input).toMatchObject({ ruleVersion: 1, config: { durationSec: 40 } });
    expect((await put(ownerA, `/channels/${channelA}/automation`, { expectedVersion: 1, config: config(60) })).status).toBe(409);
  });

  it('rejects new expensive work atomically when the workspace budget is exhausted', async () => {
    expect((await put(ownerA, '/budget-policy', { dailyLimitUsd: 0, monthlyLimitUsd: 0 })).status).toBe(200);
    const beforeRuns = await db.workflowRun.count({ where: { workspaceId: workspaceA } });
    const beforeEvents = await db.outboxEvent.count({ where: { workspaceId: workspaceA } });
    const blocked = await post(ownerA, `/channels/${channelA}/automation/run`, {});
    expect(blocked.status).toBe(409); expect(blocked.body.code).toBe('DAILY_BUDGET_EXCEEDED');
    expect(await db.workflowRun.count({ where: { workspaceId: workspaceA } })).toBe(beforeRuns);
    expect(await db.outboxEvent.count({ where: { workspaceId: workspaceA } })).toBe(beforeEvents);
    expect((await put(ownerA, '/budget-policy', { dailyLimitUsd: 5, monthlyLimitUsd: 50 })).status).toBe(200);
  });

  it('pauses creation and emergency stop cancels queued runs and releases reservations', async () => {
    expect((await post(ownerA, `/channels/${channelA}/automation/control`, { action: 'PAUSE' })).body.status).toBe('PAUSED');
    expect((await post(ownerA, `/channels/${channelA}/automation/run`, {})).status).toBe(409);
    expect((await post(ownerA, `/channels/${channelA}/automation/control`, { action: 'RESUME' })).body.status).toBe('ACTIVE');
    expect((await post(ownerA, `/channels/${channelA}/automation/run`, {})).status).toBe(201);
    const runningPost = await db.sourcePost.create({ data: { workspaceId: workspaceA, channelId: channelA, platform: 'MANUAL', externalPostId: `${namespace}-running-child`, canonicalUrl: 'https://example.org/running-child', body: 'Synthetic running child fixture.', contentHash: 'b'.repeat(64) } });
    const runningStory = await db.storyProject.create({ data: { workspaceId: workspaceA, sourcePostId: runningPost.id, channelId: channelA } });
    const child = await db.productionRun.create({ data: { workspaceId: workspaceA, storyProjectId: runningStory.id, requestedById: users[0]!, idempotencyKey: `${namespace}:running-child`, status: 'RUNNING', attempts: 1, workerLeaseUntil: new Date(Date.now() + 60_000), input: {} } });
    await db.workflowRun.update({ where: { workspaceId_id: { workspaceId: workspaceA, id: runId } }, data: { status: 'WAITING_PRODUCTION', output: { productionRunId: child.id } } });
    expect((await post(ownerA, `/channels/${channelA}/automation/control`, { action: 'EMERGENCY_STOP' })).body.status).toBe('STOPPED');
    expect((await post(ownerA, `/channels/${channelA}/automation/run`, {})).status).toBe(409);
    expect(await db.workflowRun.count({ where: { workspaceId: workspaceA, entityType: 'AUTOPILOT', status: 'CANCELLED' } })).toBe(2);
    expect(await db.budgetReservation.count({ where: { workspaceId: workspaceA, status: 'ACTIVE' } })).toBe(0);
    expect((await db.productionRun.findFirstOrThrow({ where: { id: child.id, workspaceId: workspaceA } })).status).toBe('RUNNING');
    expect((await db.budgetReservation.findFirstOrThrow({ where: { workspaceId: workspaceA, workflowRunId: runId } })).status).toBe('CLOSING');
  });

  it('scopes controls, reads and database workflow relations to the authenticated tenant', async () => {
    expect((await ownerB.get(`${prefix}/automation/runs/${runId}`)).status).toBe(404);
    expect((await post(ownerB, `/automation/runs/${runId}/cancel`, {})).status).toBe(404);
    expect((await post(ownerB, `/channels/${channelA}/automation/control`, { action: 'RESUME' })).status).toBe(404);
    expect((await put(ownerB, `/channels/${channelA}/automation`, { expectedVersion: 0, config: config() })).status).toBe(404);
    const listing = await ownerB.get(`${prefix}/automation`).set('X-Workspace-ID', workspaceA);
    expect(listing.body.runs).toEqual([]);
    await expect(db.workflowStep.create({ data: { workspaceId: workspaceB, workflowRunId: runId, name: 'TENANT_FK_ATTACK' } })).rejects.toMatchObject({ code: 'P2003' });
    expect((await ownerA.get(`${prefix}/analytics/overview?channelId=${channelB}`)).status).toBe(404);
  });

  it('stores manual snapshots with nullable availability and protects their history', async () => {
    const source = await db.sourcePost.create({ data: { workspaceId: workspaceA, channelId: channelA, platform: 'MANUAL', externalPostId: `${namespace}-source`, canonicalUrl: 'https://example.org/owned-phase5-story', title: 'Owned phase five fixture', body: 'The author supplied this test story.', contentHash: randomUUID() } });
    sourcePostId = source.id;
    await db.contentRight.create({ data: { workspaceId: workspaceA, sourcePostId, basis: 'OWNED', reviewStatus: 'APPROVED', commercialAllowed: true, attested: true, allowedPlatforms: ['YOUTUBE'], territory: 'WORLDWIDE' } });
    const story = await db.storyProject.create({ data: { workspaceId: workspaceA, sourcePostId, channelId: channelA } });
    const asset = await db.mediaAsset.create({ data: { workspaceId: workspaceA, kind: 'VIDEO', storageKey: `${namespace}/${randomUUID()}`, checksum: 'a'.repeat(64), mimeType: 'video/mp4' } });
    const video = await db.video.create({ data: { workspaceId: workspaceA, channelId: channelA, storyProjectId: story.id, mediaAssetId: asset.id, title: 'Database test video fixture', status: 'APPROVED', reviewStatus: 'APPROVED', durationMs: 40000 } });
    videoId = video.id;
    const account = await db.socialAccount.create({ data: { workspaceId: workspaceA, platform: 'YOUTUBE', externalId: `${namespace}-mock-account`, displayName: 'Synthetic test account', status: 'CONNECTED', capabilityFlags: { analyticsProvider: 'mock' } } });
    const publication = await db.publication.create({ data: { workspaceId: workspaceA, videoId, socialAccountId: account.id, idempotencyKey: `${namespace}:publication`, status: 'PUBLISHED', remotePostId: `mock:${randomUUID()}`, publishedAt: new Date() } });
    publicationId = publication.id;
    const key = randomUUID();
    const imported = await post(ownerA, `/analytics/publications/${publicationId}/metrics`, { views: 100, likes: 0, comments: null }, key);
    expect(imported.status).toBe(201);
    expect(imported.body.snapshot.metrics).toMatchObject({ views: 100, likes: 0, comments: null, shares: null, engagementRate: null });
    expect(imported.body.snapshot.availability.comments).toBe('UNAVAILABLE');
    expect((await post(ownerA, `/analytics/publications/${publicationId}/metrics`, { views: 100, likes: 0, comments: null }, key)).body).toEqual(imported.body);
    expect((await ownerA.get(`${prefix}/analytics/publications/${publicationId}/history`)).body.items).toHaveLength(1);
    expect((await ownerB.get(`${prefix}/analytics/publications/${publicationId}/history`)).status).toBe(404);
    expect((await post(ownerB, `/analytics/publications/${publicationId}/metrics`, { views: 999 })).status).toBe(404);
    expect((await ownerB.get(`${prefix}/analytics/publications`)).body.items).toEqual([]);
    expect((await ownerA.get(`${prefix}/analytics/overview`)).body.summary.views).toBe(100);
  });

  it('requires experiment approval and assigns each source story at most once', async () => {
    const experiment = await post(ownerA, '/analytics/experiments', { channelId: channelA, name: 'Distinct story experiment', hypothesis: 'Observe hook differences on separate authorized source stories.', dimension: 'hook', variants: [{ id: 'A', config: { label: 'Question' } }, { id: 'B', config: { label: 'Statement' } }], minSamples: 10 });
    expect(experiment.status).toBe(201); expect(experiment.body.status).toBe('PENDING_APPROVAL');
    const id = experiment.body.id as string;
    expect((await post(ownerA, `/analytics/experiments/${id}/assign`, { videoId })).status).toBe(409);
    expect((await post(ownerB, `/analytics/experiments/${id}/approve`, {})).status).toBe(404);
    expect((await post(ownerA, `/analytics/experiments/${id}/approve`, {})).status).toBe(201);
    const assignment = await post(ownerA, `/analytics/experiments/${id}/assign`, { videoId });
    expect(assignment.status).toBe(201);
    expect((await post(ownerA, `/analytics/experiments/${id}/assign`, { videoId })).body.id).toBe(assignment.body.id);
    const second = await db.video.create({ data: { workspaceId: workspaceA, channelId: channelA, storyProjectId: (await db.video.findUniqueOrThrow({ where: { id: videoId } })).storyProjectId, mediaAssetId: (await db.video.findUniqueOrThrow({ where: { id: videoId } })).mediaAssetId, title: 'Same source second render', status: 'APPROVED', reviewStatus: 'APPROVED' } });
    const duplicate = await post(ownerA, `/analytics/experiments/${id}/assign`, { videoId: second.id });
    expect(duplicate.status).toBe(409); expect(duplicate.body.code).toBe('EXPERIMENT_CONTENT_REUSED');
    expect(await db.experimentAssignment.count({ where: { workspaceId: workspaceA, experimentId: id } })).toBe(1);
    const results = await ownerA.get(`${prefix}/analytics/experiments`);
    expect(results.body.items.find((item: { id: string }) => item.id === id).results.status).toBe('INSUFFICIENT_DATA');
  });
});
