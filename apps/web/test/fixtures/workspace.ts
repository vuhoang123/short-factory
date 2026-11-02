import type { Page } from '@playwright/test';

export const channelId = '11111111-1111-4111-8111-111111111111';
export const now = '2026-10-27T12:00:00.000Z';

export async function mockWorkspace(page: Page) {
  const mutations: Array<{ path: string; body: unknown }> = [];
  let topicRuleRequests = 0;
  let ruleVersion = 1;
  let ruleStatus = 'ACTIVE';
  let recommendationStatus = 'PENDING';
  let experimentStatus = 'PENDING_APPROVAL';
  let pending = true;
  const config: Record<string, unknown> = { mode: 'SEMI_AUTO', sourceIds: ['source-1'], voiceProfileId: 'mock-vi', languages: ['vi'], topics: ['community'], targetPlatforms: ['YOUTUBE'], accountIds: ['account-1'] };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() === 'GET' && path === '/topic-rules') topicRuleRequests += 1;
    if (request.method() !== 'GET') {
      const body: unknown = request.postDataJSON(); mutations.push({ path, body });
      if (path.endsWith('/automation') && body && typeof body === 'object' && 'config' in body) { Object.assign(config, body.config); ruleVersion += 1; }
      if (path.endsWith('/automation/control') && body && typeof body === 'object' && 'action' in body) ruleStatus = body.action === 'PAUSE' ? 'PAUSED' : body.action === 'EMERGENCY_STOP' ? 'STOPPED' : 'ACTIVE';
      if (path.endsWith('/reviews')) pending = false;
      if (path.endsWith('/decision')) recommendationStatus = 'ACCEPTED';
      if (path.endsWith('/approve')) experimentStatus = 'APPROVED';
      await route.fulfill({ json: path.endsWith('/automation/run') ? { dryRun: true, selected: { candidateId: 'candidate-1' }, gates: ['HUMAN_REVIEW_REQUIRED'] } : { ok: true } }); return;
    }
    const run = { id: 'run-1', entityId: channelId, status: 'AWAITING_APPROVAL', currentStep: 'APPROVAL_GATE', createdAt: now, updatedAt: now, input: { version: ruleVersion }, output: { quality: { status: 'NEEDS_REVIEW', score: 90 } } };
    const data: Record<string, unknown> = {
      '/auth/me': { user: { id: 'owner-1', email: 'fixture@example.org', name: 'Fixture owner' }, workspaces: [{ id: 'workspace-1', name: 'UI contract fixture', role: 'OWNER' }], activeWorkspaceId: 'workspace-1' },
      '/channels': { items: [{ id: channelId, name: 'Community stories', language: 'vi' }] },
      '/topic-rules': { items: [{ id: 'topic-rule-1', workspaceId: 'workspace-1', channelId, name: 'Giật kinh hồn', keywords: ['giật kinh hồn'], hashtags: [], topics: ['bất ngờ'], language: 'vi', allow: [], deny: [], minimumScore: 55, enabled: true }] },
      '/workspaces/workspace-1/members': { items: [] },
      '/audit-logs': { items: [] },
      '/sources': { items: [{ id: 'source-1', platform: 'MANUAL', sourceKey: 'Owned community archive', enabled: true, capabilityStatus: 'AVAILABLE' }] },
      '/voice-profiles': { items: [{ id: 'mock-vi', name: 'Vietnamese test voice', provider: 'mock', language: 'vi', voiceId: 'vi', requiresCredentials: false }] },
      '/automation/accounts': { items: [{ id: 'account-1', displayName: 'Fixture channel', platform: 'YOUTUBE', status: 'MOCK_ONLY' }] },
      '/automation': { rules: [{ id: 'rule-1', channelId, version: ruleVersion, status: ruleStatus, config, channel: { id: channelId, name: 'Community stories' } }], runs: [run], summary: { activeRules: ruleStatus === 'ACTIVE' ? 1 : 0, running: 0, queued: 0, pendingApproval: pending ? 1 : 0, scheduled: 0, failed: 0, estimatedSpendUsd: 0.12, billedSpendUsd: null } },
      '/automation/runs/run-1': { ...run, steps: [{ id: 'step-1', name: 'QUALITY_VALIDATION', status: 'SUCCEEDED', startedAt: now, completedAt: now, errorCode: null, output: { status: 'NEEDS_REVIEW', score: 90 } }] },
      '/automation/approvals': { items: pending ? [{ id: 'video-1', title: 'An owned community story', mediaAssetId: null, story: { post: { title: 'Community source', body: 'An authorized synthetic story.', rights: [{ reviewStatus: 'APPROVED', basis: 'OWNED' }] } }, qualityReport: { status: 'NEEDS_REVIEW', score: 90, issues: ['Approximate alignment requires review'] }, targetPlatforms: ['YOUTUBE'] }] : [] },
      '/videos': { items: [{ id: 'approved-video-1', channelId, title: 'Approved experiment video', status: 'APPROVED', reviewStatus: 'APPROVED', mediaAssetId: 'media-1', createdAt: now, durationMs: 1000 }] },
      '/dashboard': { phase: 'PHASE_3', counts: { posts: 0, comments: 0, channels: 1, sources: 1, pendingRights: 0, blockedRights: 0, candidates: 0, pendingSources: 0 }, integrations: { sources: 'AVAILABLE', media: 'AVAILABLE', publishing: 'BLOCKED_EXTERNAL', tiktok: 'BLOCKED_EXTERNAL' }, blockers: [] },
      '/posts': { items: [] }, '/candidates': { items: [] }, '/backgrounds': { items: [] }, '/video-templates': { items: [] },
      '/production-runs': { items: [], nextCursor: null },
      '/usage': { dailyEstimatedUsd: 0.12, monthlyEstimatedUsd: 0.12, reservedUsd: 0, billedUsd: null, byStage: [{ stage: 'TTS_GENERATION', estimatedUsd: 0.12, units: 400 }], alerts: [] },
      '/budget-policy': { dailyLimitUsd: 5, monthlyLimitUsd: 50, warningThreshold: 0.8 },
      '/analytics/overview': { summary: { produced: 4, published: 2, views: null, engagementRate: null, publicationSuccessRate: 1, automationSuccessRate: 0.75, estimatedCostUsd: 0.48, billedCostUsd: null }, trend: [{ date: '2026-10-26', views: null, engagement: null, produced: 2, published: 1, failed: 0, costUsd: 0.24 }, { date: '2026-10-27', views: null, engagement: null, produced: 2, published: 1, failed: 0, costUsd: 0.24 }], byPlatform: [{ platform: 'YOUTUBE', views: null, published: 2 }], content: [], freshness: { lastSyncedAt: null, stale: true }, blockers: [] },
      '/analytics/publications': { items: [{ id: 'publication-1', video: { title: 'An owned community story' }, account: { displayName: 'Fixture channel', platform: 'YOUTUBE' }, remotePostId: 'mock:publication-1', status: 'PUBLISHED', metrics: [] }] },
      '/analytics/publications/publication-1/history': { items: [] },
      '/analytics/recommendations': { items: [{ id: 'recommendation-1', status: recommendationStatus, kind: 'template', title: 'Inspect observed template differences', explanation: 'This fixture has ten observations per template. The association is not causal.', evidence: { samples: 20, snapshotIds: ['metric-1'] }, createdAt: now }] },
      '/analytics/experiments': { items: [{ id: 'experiment-1', channelId, name: 'Template comparison', hypothesis: 'Compare two templates on separate eligible stories.', status: experimentStatus, variants: [{ id: 'A', config: { templateId: 'RedditStory' } }, { id: 'B', config: { templateId: 'SocialCommentary' } }], results: { status: 'INCONCLUSIVE', samples: 0, reason: 'Minimum samples not met' } }] },
      '/analytics/sync-runs': { items: [] },
    };
    await route.fulfill({ json: data[path] ?? {} });
  });
  return { mutations, topicRuleRequests: () => topicRuleRequests };
}

