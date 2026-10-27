import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const channelId = '11111111-1111-4111-8111-111111111111';
const now = '2026-10-27T12:00:00.000Z';

async function mockWorkspace(page: Page) {
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
      '/voice-profiles': { items: [{ id: 'mock-vi', name: 'Vietnamese test voice', provider: 'mock', language: 'vi' }] },
      '/automation/accounts': { items: [{ id: 'account-1', displayName: 'Fixture channel', platform: 'YOUTUBE', status: 'MOCK_ONLY' }] },
      '/automation': { rules: [{ id: 'rule-1', channelId, version: ruleVersion, status: ruleStatus, config, channel: { id: channelId, name: 'Community stories' } }], runs: [run], summary: { activeRules: ruleStatus === 'ACTIVE' ? 1 : 0, running: 0, queued: 0, pendingApproval: pending ? 1 : 0, scheduled: 0, failed: 0, estimatedSpendUsd: 0.12, billedSpendUsd: null } },
      '/automation/runs/run-1': { ...run, steps: [{ id: 'step-1', name: 'QUALITY_VALIDATION', status: 'SUCCEEDED', startedAt: now, completedAt: now, errorCode: null, output: { status: 'NEEDS_REVIEW', score: 90 } }] },
      '/automation/approvals': { items: pending ? [{ id: 'video-1', title: 'An owned community story', mediaAssetId: null, story: { post: { title: 'Community source', body: 'An authorized synthetic story.', rights: [{ reviewStatus: 'APPROVED', basis: 'OWNED' }] } }, qualityReport: { status: 'NEEDS_REVIEW', score: 90, issues: ['Approximate alignment requires review'] }, targetPlatforms: ['YOUTUBE'] }] : [] },
      '/videos': { items: [{ id: 'approved-video-1', channelId, title: 'Approved experiment video', status: 'APPROVED', reviewStatus: 'APPROVED', mediaAssetId: 'media-1' }] },
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

test('channel rules, pause, dry run and approval inbox use real request contracts', async ({ page }) => {
  const { mutations } = await mockWorkspace(page);
  await page.goto('/autopilot');
  await expect(page.getByRole('heading', { name: 'Content autopilot', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Content channel', exact: true })).toHaveValue(channelId);
  await page.getByLabel('Minimum candidate score', { exact: true }).fill('65');
  await page.getByRole('button', { name: 'Save rule version', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('new rule version');
  expect(mutations.find((item) => item.path.endsWith('/automation'))?.body).toMatchObject({ expectedVersion: 1, config: { minScore: 65, voiceProfileId: 'mock-vi', requireApproval: true } });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dry run', exact: true }).click();
  await page.getByText('Dry-run selection and gates', { exact: true }).click();
  await expect(page.getByText('HUMAN_REVIEW_REQUIRED', { exact: false })).toBeVisible();
  expect(mutations.find((item) => item.path.endsWith('/automation/run'))?.body).toEqual({ dryRun: true });
  await page.getByRole('button', { name: /Community stories.*APPROVAL GATE/i }).click();
  await expect(page.getByText('QUALITY VALIDATION', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No videos awaiting review', exact: true })).toBeVisible();
  expect(mutations.some((item) => item.path === '/videos/video-1/reviews')).toBe(true);
  await mkdir('test-results/phase5-ui', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/phase5-ui/autopilot-fixture.png', fullPage: true });
});

test('analytics preserves missing metrics and records deliberate recommendation and experiment decisions', async ({ page }) => {
  const { mutations } = await mockWorkspace(page);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics and learning', exact: true })).toBeVisible();
  await expect(page.getByText('Analytics data is stale or has not been collected.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No metric observations yet', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Chart metric', exact: true }).selectOption('produced');
  await expect(page.getByRole('img', { name: 'Production volume over time. Missing observations are left blank.' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh metrics', exact: true }).click();
  expect(mutations.some((item) => item.path === '/analytics/publications/publication-1/refresh')).toBe(true);
  await page.getByText('Import a manual metric snapshot', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Publication', exact: true }).selectOption('publication-1');
  await page.getByLabel('Views', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save manual observation', exact: true }).click();
  expect(mutations.find((item) => item.path.endsWith('/metrics'))?.body).toMatchObject({ views: 0, likes: null, shares: null });
  await page.getByRole('combobox', { name: 'Publication history', exact: true }).selectOption('publication-1');
  await expect(page.getByRole('heading', { name: 'No metric history yet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accept recommendation', exact: true }).click();
  await expect(page.getByText('accepted', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve experiment', exact: true }).click();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Template comparison', exact: true }).selectOption('approved-video-1');
  await page.getByRole('button', { name: 'Assign to variant', exact: true }).click();
  expect(mutations.find((item) => item.path.endsWith('/assign'))?.body).toEqual({ videoId: 'approved-video-1' });
  await mkdir('test-results/phase5-ui', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/phase5-ui/analytics-fixture.png', fullPage: true });
});

test('discovery topic rules stay loaded without repeatedly refetching and flashing', async ({ page }) => {
  const { topicRuleRequests } = await mockWorkspace(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Discovery topic rules', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Giật kinh hồn', exact: true })).toBeVisible();
  await expect(page.getByText('Loading topic rules…')).toHaveCount(0);
  const stableRequestCount = topicRuleRequests();
  await page.waitForTimeout(1200);
  expect(topicRuleRequests()).toBe(stableRequestCount);
});
