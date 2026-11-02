import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { mockWorkspace, channelId, now } from './fixtures/workspace';

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const postId = id(101); const candidateId = id(102); const storyId = id(103); const draftId = id(104); const renderId = id(105); const videoId = id(106); const assetId = id(107);

async function productFixture(page: Page) {
  const base = await mockWorkspace(page);
  const mutations: Array<{ path: string; body: Record<string, unknown>; key: string }> = [];
  let candidateStatus = 'PENDING_REVIEW'; let drafted = false; let rendered = false; let approved = false;
  let version = 1;
  let savedSettings: Record<string, unknown> = { channelId, commentIds: [], templateId: 'SocialCommentary', subtitlePreset: 'ClassicCaption', theme: 'dark', backgroundAssetId: null, voiceProfileId: 'mock-vi', speakingRate: 1 };
  let segments = [{ id: 'hook', type: 'HOOK', text: 'Câu chuyện của khu phố', sourceRefs: [`post:${postId}`], narrationType: 'ORIGINAL_COMMENTARY', estimatedDurationMs: 2000 }, { id: 'post', type: 'POST', text: 'Mọi người cùng góp sách cho thư viện nhỏ.', sourceRefs: [`post:${postId}`], narrationType: 'VERBATIM', estimatedDurationMs: 3000 }];
  const post = { id: postId, title: 'Thư viện nhỏ trong khu phố', body: 'Mọi người cùng góp sách cho thư viện nhỏ.', platform: 'MANUAL', canonicalUrl: 'https://example.org/owned-library', externalPostId: 'library', discoveredAt: now, topicTags: ['cộng đồng'], sensitiveFlags: [], synthetic: true, channel: { id: channelId, name: 'Community stories', language: 'vi', minimumCandidateScore: 55 }, comments: [{ id: id(108), externalId: 'comment-1', body: 'Chúng tôi đọc sách cùng nhau mỗi tuần.', likes: null, sensitiveFlags: [] }], rights: [{ id: id(109), basis: 'OWNED', reviewStatus: 'APPROVED', attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], territory: 'VN', attributionRequired: false }], metricSnapshots: [{ likes: 81, replies: 1, shares: 4, views: null, measuredAt: now }], _count: { comments: 1 } };
  const currentRun = () => drafted ? { id: rendered ? renderId : draftId, storyProjectId: storyId, status: 'SUCCEEDED', currentStage: rendered ? 'READY_FOR_REVIEW' : 'SCRIPT_READY', errorCode: null, progress: 1 } : null;
  const item = () => ({ id: postId, post, candidate: { id: candidateId, status: candidateStatus, score: 80, minimumScore: 55, reasoning: 'Câu chuyện có nguồn rõ ràng và phù hợp video ngắn.' }, run: currentRun(), video: rendered ? { id: videoId, title: post.title, reviewStatus: approved ? 'APPROVED' : 'PENDING', assetId } : null, lifecycle: { state: approved ? 'APPROVED' : rendered ? 'REVIEW' : drafted ? 'SCRIPTING' : candidateStatus === 'APPROVED' ? 'SELECTED' : 'DISCOVERED', blockedReason: null, nextAction: 'Mở Studio để tạo kịch bản', simulated: false } });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace('/api/v1', '');
    if (['POST', 'PATCH'].includes(request.method())) {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({ path, body, key: request.headers()['idempotency-key'] ?? '' });
      if (path === `/candidates/${candidateId}/review`) { candidateStatus = 'APPROVED'; await route.fulfill({ json: { id: candidateId, status: candidateStatus } }); return; }
      if (path === `/candidates/${candidateId}/produce`) { drafted = true; savedSettings = { ...savedSettings, ...body }; await route.fulfill({ json: { runId: draftId, storyProjectId: storyId, status: 'QUEUED' } }); return; }
      if (path === `/stories/${storyId}`) { version++; segments = (body.script as { segments: typeof segments }).segments; await route.fulfill({ json: { id: storyId, versionId: id(111), version } }); return; }
      if (path === `/stories/${storyId}/render`) { rendered = true; savedSettings = { ...savedSettings, ...body }; await route.fulfill({ json: { runId: renderId, storyProjectId: storyId, status: 'QUEUED' } }); return; }
      if (path === `/stories/${storyId}/audio`) { await route.fulfill({ json: { runId: draftId, storyProjectId: storyId, status: 'QUEUED' } }); return; }
      if (path === `/videos/${videoId}/reviews`) { approved = true; await route.fulfill({ json: { videoId, status: 'APPROVED', reviewStatus: 'APPROVED' } }); return; }
      return route.fallback();
    }
    if (path === '/studio/content' || path === `/studio/content/${postId}`) { await route.fulfill({ json: { items: [item()], nextCursor: null } }); return; }
    if (path === `/posts/${postId}/comment-selection`) { await route.fulfill({ json: { items: post.comments.map((comment) => ({ ...comment, likes: 81 })), targetCount: 5, availableCount: 1, reactionsKnown: 1, selectionBasis: 'REACTIONS' } }); return; }
    if (path === `/posts/${postId}/comments`) { await route.fulfill({ json: { items: post.comments } }); return; }
    if (path === `/production-runs/${draftId}` || path === `/production-runs/${renderId}`) { await route.fulfill({ json: { ...currentRun(), input: savedSettings, stages: [], renderJob: { progress: 1 }, videos: rendered ? [{ id: videoId, status: 'READY_FOR_REVIEW', mediaAsset: { id: assetId } }] : [] } }); return; }
    if (path === `/stories/${storyId}`) { await route.fulfill({ json: { id: storyId, channel: { id: channelId, name: 'Community stories', language: 'vi' }, post: { ...post, authorAlias: null }, versions: [{ id: id(110 + version), version, script: { version, language: 'vi', title: post.title, targetDurationSec: 25, segments }, modelVersion: 'mock-fixture', audioAssets: [], subtitleTracks: [] }] } }); return; }
    if (path === '/video-templates') { await route.fulfill({ json: { items: [{ id: 'SocialCommentary', version: 1, name: 'Social commentary', description: 'Owned test fixture', status: 'READY' }] } }); return; }
    if (path === `/videos/${videoId}`) { await route.fulfill({ json: { id: videoId, title: post.title, status: 'READY_FOR_REVIEW', reviewStatus: approved ? 'APPROVED' : 'PENDING', durationMs: 5000, width: 1080, height: 1920, fps: 30, renderManifest: null, mediaAsset: { id: assetId, mimeType: 'video/mp4', checksum: '0'.repeat(64), metadata: null }, story: { id: storyId, channel: null, post: { ...post, authorAlias: null }, versions: [] } } }); return; }
    if (path === '/videos') { await route.fulfill({ json: { items: rendered ? [{ id: videoId, title: post.title, status: 'READY_FOR_REVIEW', reviewStatus: approved ? 'APPROVED' : 'PENDING', mediaAssetId: assetId, durationMs: 5000, createdAt: now }] : [] } }); return; }
    if (path.startsWith('/media/')) { await route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }); return; }
    await route.fallback();
  });
  return { mutations, base };
}

test('Discover → exact Studio draft → edit version → explicit MP4 → review and handoff', async ({ page }) => {
  const fixture = await productFixture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (/Maximum update depth|Too many re-renders/.test(message.text())) errors.push(message.text()); });
  await page.goto('/discover');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(5);
  await page.getByRole('button', { name: 'Xem chi tiết →', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nội dung đang xem' });
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button', { name: 'Chọn nội dung này' }).click();
  await dialog.getByRole('link', { name: 'Tiếp tục trong Studio →' }).click();
  await expect(page).toHaveURL(new RegExp(`posts=${postId}`));
  await expect(page.getByRole('heading', { name: 'Studio', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Chúng tôi đọc sách cùng nhau mỗi tuần.', exact: true }).check();
  await page.getByRole('combobox', { name: 'Speaking rate', exact: true }).selectOption('1.15');
  await page.getByRole('button', { name: 'Tạo bản nháp kịch bản', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Script editor' })).toBeVisible();
  expect(fixture.mutations.find((entry) => entry.path.endsWith('/produce'))?.body.draftOnly).toBe(true);
  expect(fixture.mutations.find((entry) => entry.path.endsWith('/produce'))?.body.commentIds).toEqual([id(108)]);
  expect(fixture.mutations.some((entry) => entry.path.endsWith('/render'))).toBe(false);
  const hook = page.getByLabel('HOOK text', { exact: true });
  await hook.fill('Một thư viện nhỏ đã gắn kết cả khu phố.');
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(hook).toHaveValue('Một thư viện nhỏ đã gắn kết cả khu phố.');
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Nghe thử giọng', exact: true }).click();
  await expect(page.getByText('Đang tạo bản nghe thử ngắn với giọng và tốc độ đã chọn. Chưa dựng video.')).toBeVisible();
  expect(fixture.mutations.find((entry) => entry.path.endsWith('/audio'))?.body).toEqual({ voiceProfileId: 'mock-vi', speakingRate: 1.15, preview: true });
  expect(fixture.mutations.some((entry) => entry.path.endsWith('/render'))).toBe(false);
  await mkdir('../../docs/screenshots/milestone-2', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../../docs/screenshots/milestone-2/studio-editor-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Tạo video MP4', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Video preview', exact: true })).toBeVisible();
  expect(fixture.mutations.find((entry) => entry.path.endsWith('/render'))?.body).toMatchObject({ speakingRate: 1.15, voiceProfileId: 'mock-vi' });
  await expect(page.getByRole('link', { name: 'Download MP4', exact: true })).toHaveAttribute('href', `/api/v1/media/${assetId}?download=1`);
  await page.getByRole('button', { name: 'Approve video', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('BLOCKED_EXTERNAL', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tải MP4', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Xem trong Studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Video preview', exact: true })).toBeVisible();
  await expect(page.locator('.studio-source strong')).toHaveText('Thư viện nhỏ trong khu phố');
  await page.locator('.studio-setup > summary').click();
  await expect(page.getByRole('combobox', { name: 'Speaking rate', exact: true })).toHaveValue('1.15');
  await expect(page.getByRole('checkbox', { name: 'Chúng tôi đọc sách cùng nhau mỗi tuần.', exact: true })).toBeChecked();
  expect(fixture.mutations.every((entry) => !entry.path.includes('/publish') && entry.key.length > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('bulk candidate approval requires confirmation and records each item without rendering', async ({ page }) => {
  const fixture = await productFixture(page);
  await page.goto('/discover');
  await page.getByRole('checkbox', { name: 'Chọn Thư viện nhỏ trong khu phố', exact: true }).check();
  const review = page.getByRole('button', { name: 'Duyệt chọn các bài đủ điều kiện', exact: true });
  await expect(review).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra từng bài được chọn và quyền sử dụng hiện hành.', exact: true }).check();
  await review.click();
  await expect(page.getByRole('status')).toContainText('đã chọn');
  expect(fixture.mutations).toHaveLength(1);
  expect(fixture.mutations[0]?.path).toBe(`/candidates/${candidateId}/review`);
});

test('bulk selection opens an editing queue without starting production, and Escape restores focus', async ({ page }) => {
  const fixture = await productFixture(page);
  await page.goto('/discover');
  await page.getByRole('checkbox', { name: 'Chọn Thư viện nhỏ trong khu phố', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Duyệt chọn các bài đủ điều kiện' })).toBeDisabled();
  await page.getByRole('link', { name: 'Mở 1 bài trong Studio' }).click();
  await expect(page.getByRole('navigation', { name: 'Hàng đợi biên tập' })).toBeVisible();
  await expect(page.getByText('Bài này chưa đủ điều kiện', { exact: true })).toBeVisible();
  expect(fixture.mutations).toEqual([]);
  await page.goto('/discover');
  await page.getByRole('button', { name: 'Xem chi tiết →', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xem chi tiết →', exact: true })).toBeFocused();
});

test('new product screens remain stable on mobile and document the implemented views', async ({ page }) => {
  await productFixture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('../../docs/screenshots/milestone-2', { recursive: true });
  for (const route of ['/dashboard', '/discover', '/studio', '/publish']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `../../docs/screenshots/milestone-2/${route.slice(1)}-desktop.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/dashboard', '/discover', `/studio?posts=${postId}`, '/studio?mode=import', '/publish']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), route).toBe(true);
  }
  await page.goto('/discover');
  await page.screenshot({ path: '../../docs/screenshots/milestone-2/discover-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('viewers keep read access while editorial actions remain unavailable', async ({ page }) => {
  const fixture = await productFixture(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user: { id: 'viewer', email: 'viewer@example.org' }, workspaces: [{ id: 'workspace-1', name: 'Read only workspace', role: 'VIEWER' }], activeWorkspaceId: 'workspace-1' } }));
  await page.goto('/discover');
  await page.getByRole('button', { name: 'Xem chi tiết →', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Chọn nội dung này', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.goto(`/studio?posts=${postId}`);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Tạo bản nháp kịch bản', exact: false })).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});
