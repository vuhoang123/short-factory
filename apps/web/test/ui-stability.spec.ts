import { expect, test } from '@playwright/test';
import { channelId, mockWorkspace, now } from './fixtures/workspace';

test('all workspace routes settle without repeated fetching or update-depth errors', async ({ page }) => {
  await mockWorkspace(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (/Maximum update depth|Too many re-renders/.test(message.text())) errors.push(message.text()); });
  let requests = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) requests++; });
  for (const route of ['/dashboard', '/discover', '/publish', '/channels', '/sources', '/library/posts', '/reviews', '/studio', '/export', '/autopilot', '/analytics', '/settings', '/guide']) {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const settled = requests;
    await page.waitForTimeout(650);
    expect(requests, route).toBe(settled);
    await expect(page.getByText('The server returned an unexpected response.', { exact: false })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('refreshing topic rules preserves the mounted editor and its unsaved draft', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  const name = page.getByLabel('Tên', { exact: true });
  await name.fill('Unsaved editorial draft');
  const editor = await name.elementHandle();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const refreshing = new Promise<void>((resolve) => { started = resolve; });
  await page.route('**/api/v1/topic-rules?**', async (route) => { started(); await gate; await route.fallback(); });
  try {
    await page.getByRole('button', { name: 'Tắt', exact: true }).click();
    await refreshing;
    await expect.poll(() => editor!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(name).toHaveValue('Unsaved editorial draft');
  } finally { release(); }
  await page.waitForLoadState('networkidle');
  await expect(name).toHaveValue('Unsaved editorial draft');
});

test('slow background polling stays single-flight and stops when leaving the page', async ({ page }) => {
  await page.clock.install();
  await mockWorkspace(page);
  await page.goto('/autopilot');
  await expect(page.getByRole('combobox', { name: 'Kênh nội dung', exact: true })).toHaveValue(channelId);
  await page.waitForLoadState('networkidle');
  let requests = 0;
  let aborted = false;
  page.on('requestfailed', (request) => { if (new URL(request.url()).pathname === '/api/v1/automation') aborted = true; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/automation', async (route) => { requests++; await gate; await route.fallback(); });
  try {
    await page.clock.runFor(10_100);
    await expect.poll(() => requests).toBe(1);
    await page.clock.runFor(20_000);
    expect(requests).toBe(1);
    await page.locator('.account-menu > summary').click();
    await page.getByRole('link', { name: 'Cài đặt workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect.poll(() => aborted).toBe(true);
    await page.clock.runFor(30_000);
    expect(requests).toBe(1);
  } finally { release(); }
});

test('Studio stops polling cancelled runs and cancels scheduled polling on navigation', async ({ page }) => {
  await mockWorkspace(page);
  const sourceId = '00000000-0000-4000-8000-000000000101';
  const candidateId = '00000000-0000-4000-8000-000000000102';
  const source = { id: sourceId, title: 'Owned fixture', body: 'Original synthetic story.', canonicalUrl: 'https://example.org/owned-story', platform: 'MANUAL', externalPostId: 'owned-1', discoveredAt: now, rights: [], comments: [], channel: { id: channelId, name: 'Community stories', language: 'vi', minimumCandidateScore: 55 } };
  await page.route(`**/api/v1/posts/${sourceId}/comment-selection?**`, (route) => route.fulfill({ json: { items: [], targetCount: 5, availableCount: 0, reactionsKnown: 0, selectionBasis: 'PARTIAL_OR_MISSING_REACTIONS' } }));
  await page.route(`**/api/v1/posts/${sourceId}/comments?**`, (route) => route.fulfill({ json: { items: [] } }));
  await page.route(`**/api/v1/studio/content/${sourceId}`, (route) => route.fulfill({ json: { items: [{ id: sourceId, post: source, candidate: { id: candidateId, score: 80, minimumScore: 55, status: 'APPROVED', reasoning: null }, run: null, video: null, lifecycle: { state: 'SELECTED', blockedReason: null, nextAction: 'Open Studio', simulated: false } }], nextCursor: null } }));
  await page.route('**/api/v1/candidates?**', (route) => route.fulfill({ json: { items: [{ id: 'candidate-1', score: 80, minimumScore: 55, status: 'APPROVED', modelVersion: null, reasoning: null, factors: null, eligibility: null, post: { id: 'post-1', title: 'Owned fixture', body: 'Original synthetic story.', canonicalUrl: 'https://example.org/owned-story', platform: 'MANUAL', externalPostId: 'post-1', discoveredAt: now, rights: [], comments: [] } }] } }));
  let status = 'CANCELLED';
  let requests = 0;
  let production = 0;
  await page.route('**/api/v1/candidates/*/produce', (route) => route.fulfill({ json: { runId: `production-${++production}`, storyProjectId: 'story-1', status: 'QUEUED' } }));
  await page.route('**/api/v1/stories/story-1', (route) => route.fulfill({ json: { id: 'story-1', channel: null, post: { id: 'post-1', platform: 'MANUAL', title: 'Owned fixture', body: 'Original synthetic story.', authorAlias: null, comments: [] }, versions: [] } }));
  await page.route('**/api/v1/production-runs/*', (route) => {
    requests++;
    return route.fulfill({ json: { id: 'production-1', sourcePostId: sourceId, storyProjectId: 'story-1', status, currentStage: null, errorCode: null, stages: [], renderJob: null, videos: [] } });
  });
  await page.goto('/studio?run=55555555-5555-4555-8555-555555555555');
  await page.getByRole('button', { name: 'Tạo bản nháp kịch bản', exact: false }).click();
  await expect(page.getByText('CANCELLED', { exact: true })).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  const terminalRequests = requests;
  await page.waitForTimeout(3500);
  expect(requests).toBe(terminalRequests);
  status = 'RUNNING';
  await page.getByRole('button', { name: 'Tạo bản nháp kịch bản', exact: false }).click();
  await expect(page.getByText('RUNNING', { exact: true })).toBeVisible();
  const activeRequests = requests;
  await page.locator('.account-menu > summary').click();
    await page.getByRole('link', { name: 'Cài đặt workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.waitForTimeout(2000);
  expect(requests).toBe(activeRequests);
});

test('Autopilot detail polling recovers from a temporary failure and stops after completion', async ({ page }) => {
  await mockWorkspace(page);
  let requests = 0;
  await page.route('**/api/v1/automation/runs/run-1', (route) => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 503, json: { message: 'Temporary polling failure' } });
    return route.fulfill({ json: { id: 'run-1', entityId: channelId, status: 'SUCCEEDED', currentStep: null, createdAt: now, updatedAt: now, input: {}, output: {}, steps: [] } });
  });
  await page.goto('/autopilot');
  await page.getByRole('button', { name: /Community stories.*APPROVAL GATE/i }).click();
  await expect(page.getByText('Temporary polling failure', { exact: true })).toBeVisible();
  await expect(page.getByText('succeeded', { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText('Temporary polling failure', { exact: true })).toHaveCount(0);
  const completedRequests = requests;
  await page.waitForTimeout(6500);
  expect(requests).toBe(completedRequests);
});

test('refreshing session in the same workspace keeps the current page mounted', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  const heading = await page.getByRole('heading', { name: 'Cài đặt workspace', exact: true }).elementHandle();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/auth/me', async (route) => { await gate; await route.fallback(); });
  try {
    await page.getByLabel('Email thành viên', { exact: true }).fill('fixture@example.org');
    await page.getByRole('button', { name: 'Lưu quyền truy cập', exact: true }).click();
    await expect(page.getByText('Đang mở workspace của bạn…', { exact: true })).toHaveCount(0);
    expect(await heading!.evaluate((element) => element.isConnected)).toBe(true);
  } finally { release(); }
  await page.waitForLoadState('networkidle');
  expect(await heading!.evaluate((element) => element.isConnected)).toBe(true);
});

test('switching workspace clears the previous page before loading the new workspace', async ({ page }) => {
  await mockWorkspace(page);
  let workspaceId = 'workspace-1';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/auth/me', async (route) => {
    if (workspaceId === 'workspace-2') await gate;
    await route.fulfill({ json: { user: { id: 'owner-1', email: 'fixture@example.org' }, activeWorkspaceId: workspaceId, workspaces: [{ id: 'workspace-1', name: 'First workspace', role: 'OWNER' }, { id: 'workspace-2', name: 'Second workspace', role: 'OWNER' }] } });
  });
  await page.route('**/api/v1/auth/workspace', (route) => { workspaceId = route.request().postDataJSON().workspaceId; return route.fulfill({ json: {} }); });
  await page.route('**/api/v1/workspaces/workspace-2/members?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  await page.getByLabel('Tên', { exact: true }).fill('Private draft from first workspace');
  const heading = await page.locator('h1').elementHandle();
  try {
    await page.locator('.account-menu > summary').click();
    await page.getByLabel('Workspace đang dùng', { exact: true }).selectOption('workspace-2');
    await expect(page.getByText('Đang mở workspace của bạn…', { exact: true })).toBeVisible();
    expect(await heading!.evaluate((element) => element.isConnected)).toBe(false);
  } finally { release(); }
  await expect(page.locator('#active-workspace')).toHaveValue('workspace-2');
  await expect(page.getByLabel('Tên', { exact: true })).toHaveCount(0);
});

test('an expired session clears workspace content and returns to login', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  const heading = await page.locator('h1').elementHandle();
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED', message: 'Session expired' } }));
  await page.getByLabel('Email thành viên', { exact: true }).fill('fixture@example.org');
  await page.getByRole('button', { name: 'Lưu quyền truy cập', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await heading!.evaluate((element) => element.isConnected)).toBe(false);
});

test('an old session refresh cannot overwrite a workspace switch', async ({ page }) => {
  await mockWorkspace(page);
  let workspaceId = 'workspace-1';
  let holdRefresh = false;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const staleStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route('**/api/v1/auth/me', async (route) => {
    const snapshot = workspaceId;
    if (holdRefresh && snapshot === 'workspace-1') { started(); await gate; }
    await route.fulfill({ json: { user: { id: 'owner-1', email: 'fixture@example.org' }, activeWorkspaceId: snapshot, workspaces: [{ id: 'workspace-1', name: 'First workspace', role: 'OWNER' }, { id: 'workspace-2', name: 'Second workspace', role: 'OWNER' }] } });
  });
  await page.route('**/api/v1/auth/workspace', (route) => { workspaceId = route.request().postDataJSON().workspaceId; return route.fulfill({ json: {} }); });
  await page.route('**/api/v1/workspaces/workspace-1/members', (route) => { holdRefresh = true; return route.fulfill({ json: {} }); });
  await page.route('**/api/v1/workspaces/workspace-2/members?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  try {
    await page.getByLabel('Email thành viên', { exact: true }).fill('fixture@example.org');
    await page.getByRole('button', { name: 'Lưu quyền truy cập', exact: true }).click();
    await staleStarted;
    await page.locator('.account-menu > summary').click();
    await page.getByLabel('Workspace đang dùng', { exact: true }).selectOption('workspace-2');
    await expect(page.locator('#active-workspace')).toHaveValue('workspace-2');
  } finally { release(); }
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#active-workspace')).toHaveValue('workspace-2');
});

test('retrying a terminal Autopilot run immediately resumes detail polling', async ({ page }) => {
  await mockWorkspace(page);
  let status = 'FAILED_PERMANENT';
  await page.route('**/api/v1/automation/runs/run-1', (route) => route.fulfill({ json: { id: 'run-1', entityId: channelId, status, currentStep: null, createdAt: now, updatedAt: now, input: {}, output: {}, steps: [] } }));
  await page.route('**/api/v1/automation/runs/run-1/retry', (route) => { status = 'RUNNING'; return route.fulfill({ json: {} }); });
  await page.goto('/autopilot');
  await page.getByRole('button', { name: /Community stories.*APPROVAL GATE/i }).click();
  await expect(page.getByText('failed permanent', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại bước lỗi', exact: true }).click();
  await expect(page.getByText('running', { exact: true })).toBeVisible({ timeout: 3500 });
});
