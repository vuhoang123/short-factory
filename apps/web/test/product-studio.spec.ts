import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { mockWorkspace, channelId, now } from './fixtures/workspace';

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const postId = id(101); const candidateId = id(102); const storyId = id(103); const draftId = id(104); const renderId = id(105); const videoId = id(106); const assetId = id(107);

async function productFixture(page: Page, options: { rendered?: boolean; role?: 'OWNER' | 'REVIEWER' | 'EDITOR'; reviewFailure?: boolean; longContent?: boolean } = {}) {
  const base = await mockWorkspace(page, options.role);
  const mutations: Array<{ path: string; body: Record<string, unknown>; key: string }> = [];
  let candidateStatus = options.rendered ? 'APPROVED' : 'PENDING_REVIEW'; let drafted = Boolean(options.rendered); let rendered = Boolean(options.rendered); let reviewStatus = 'PENDING';
  let version = 1;
  let savedSettings: Record<string, unknown> = { channelId, commentIds: [], templateId: 'SocialCommentary', subtitlePreset: 'ClassicCaption', theme: 'dark', backgroundAssetId: null, voiceProfileId: 'mock-vi', speakingRate: 1 };
  let segments = [{ id: 'hook', type: 'HOOK', text: 'Câu chuyện của khu phố', sourceRefs: [`post:${postId}`], narrationType: 'ORIGINAL_COMMENTARY', estimatedDurationMs: 2000 }, { id: 'post', type: 'POST', text: 'Mọi người cùng góp sách cho thư viện nhỏ.', sourceRefs: [`post:${postId}`], narrationType: 'VERBATIM', estimatedDurationMs: 3000 }];
  const post = { id: postId, title: options.longContent ? 'Một câu chuyện dài từ khu phố và những người hàng xóm. '.repeat(5) : 'Thư viện nhỏ trong khu phố', body: options.longContent ? 'Mọi người cùng góp sách cho thư viện nhỏ. '.repeat(30) : 'Mọi người cùng góp sách cho thư viện nhỏ.', platform: 'MANUAL', canonicalUrl: 'https://example.org/owned-library', externalPostId: 'library', discoveredAt: now, topicTags: ['cộng đồng'], sensitiveFlags: [], synthetic: true, channel: { id: channelId, name: 'Community stories', language: 'vi', minimumCandidateScore: 55 }, comments: [{ id: id(108), externalId: 'comment-1', body: 'Chúng tôi đọc sách cùng nhau mỗi tuần.', likes: null, sensitiveFlags: [] }], rights: [{ id: id(109), basis: 'OWNED', reviewStatus: 'APPROVED', attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], territory: 'VN', attributionRequired: false }], metricSnapshots: [{ likes: 81, replies: 1, shares: 4, views: null, measuredAt: now }], _count: { comments: 1 } };
  const currentRun = () => drafted ? { id: rendered ? renderId : draftId, storyProjectId: storyId, status: 'SUCCEEDED', currentStage: rendered ? 'READY_FOR_REVIEW' : 'SCRIPT_READY', errorCode: null, progress: 1 } : null;
  const item = () => ({ id: postId, post, candidate: { id: candidateId, status: candidateStatus, score: 80, minimumScore: 55, reasoning: 'Câu chuyện có nguồn rõ ràng và phù hợp video ngắn.' }, run: currentRun(), video: rendered ? { id: videoId, title: post.title, reviewStatus, assetId } : null, lifecycle: { state: reviewStatus === 'APPROVED' ? 'APPROVED' : rendered ? 'REVIEW' : drafted ? 'SCRIPTING' : candidateStatus === 'APPROVED' ? 'SELECTED' : 'DISCOVERED', blockedReason: null, nextAction: 'Mở Studio để tạo kịch bản', simulated: false } });
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
      if (path === `/videos/${videoId}/reviews`) {
        if (options.reviewFailure) { await route.fulfill({ status: 409, json: { code: 'VIDEO_QUALITY_BLOCKED', message: 'Video chưa vượt qua kiểm tra chất lượng.' } }); return; }
        reviewStatus = String(body.decision); await route.fulfill({ json: { videoId, status: reviewStatus, reviewStatus } }); return;
      }
      return route.fallback();
    }
    if (path === '/studio/content' || path === `/studio/content/${postId}`) { await route.fulfill({ json: { items: [item()], nextCursor: null } }); return; }
    if (path === `/posts/${postId}`) { await route.fulfill({ json: post }); return; }
    if (path === '/candidates') { await route.fulfill({ json: { items: [{ ...item().candidate, post, factors: null, modelVersion: 'fixture', eligibility: null }] } }); return; }
    if (path === `/posts/${postId}/source-images`) { await route.fulfill({ json: { items: [], captured: false } }); return; }
    if (path === `/posts/${postId}/comment-selection`) { await route.fulfill({ json: { items: post.comments.map((comment) => ({ ...comment, likes: 81 })), targetCount: 5, availableCount: 1, reactionsKnown: 1, selectionBasis: 'REACTIONS' } }); return; }
    if (path === `/posts/${postId}/comments`) { await route.fulfill({ json: { items: post.comments } }); return; }
    if (path === `/production-runs/${draftId}` || path === `/production-runs/${renderId}`) { await route.fulfill({ json: { ...currentRun(), input: savedSettings, stages: [], renderJob: { progress: 1 }, videos: rendered ? [{ id: videoId, status: 'READY_FOR_REVIEW', mediaAsset: { id: assetId } }] : [] } }); return; }
    if (path === `/stories/${storyId}`) { await route.fulfill({ json: { id: storyId, channel: { id: channelId, name: 'Community stories', language: 'vi' }, post: { ...post, authorAlias: null }, versions: [{ id: id(110 + version), version, script: { version, language: 'vi', title: post.title, targetDurationSec: Number(savedSettings.targetDurationSec ?? 25), segments }, modelVersion: 'mock-fixture', audioAssets: [], subtitleTracks: [] }] } }); return; }
    if (path === '/video-templates') { await route.fulfill({ json: { items: [{ id: 'SocialCommentary', version: 1, name: 'Social commentary', description: 'Owned test fixture', status: 'READY' }] } }); return; }
    if (path === `/videos/${videoId}`) { await route.fulfill({ json: { id: videoId, title: post.title, status: reviewStatus === 'PENDING' ? 'READY_FOR_REVIEW' : reviewStatus, reviewStatus, durationMs: 5000, width: 1080, height: 1920, fps: 30, renderManifest: null, mediaAsset: { id: assetId, mimeType: 'video/mp4', checksum: '0'.repeat(64), metadata: null }, story: { id: storyId, channel: null, post: { ...post, authorAlias: null }, versions: [] } } }); return; }
    if (path === '/videos') { await route.fulfill({ json: { items: rendered ? [{ id: videoId, title: post.title, status: reviewStatus === 'PENDING' ? 'READY_FOR_REVIEW' : reviewStatus, reviewStatus, mediaAssetId: assetId, durationMs: 5000, createdAt: now }] : [] } }); return; }
    if (path.startsWith('/media/')) { await route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }); return; }
    await route.fallback();
  });
  return { mutations, base };
}

test('CC0 catalog previews, filters and selects assets without producing a video', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true });
  const installed = new Set<string>(); const requests: Array<{ keys: string[]; key: string }> = [];
  const entries = [
    { key: 'scene-test', kind: 'BACKGROUND', name: 'Rừng xanh CC0', category: 'Minh họa', artist: 'Nidhoggn', description: 'Synthetic preview fixture', durationMs: 8000, id: id(401), mimeType: 'video/mp4' },
    { key: 'first-snow', kind: 'MUSIC', name: 'First Snow', category: 'Lo-fi', artist: 'Holizna', description: 'Synthetic preview fixture', durationMs: 60000, id: id(402), mimeType: 'audio/wav' },
  ].map(entry => ({ ...entry, license: 'CC0-1.0', sourceUrl: 'https://opengameart.org/content/lo-fi-and-chill-collection', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }));
  await page.route('**/api/v1/studio-assets', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { keys: string[] }; requests.push({ ...body, key: route.request().headers()['idempotency-key']! });
      for (const key of body.keys) installed.add(key);
      await route.fulfill({ json: { items: entries.filter(entry => body.keys.includes(entry.key)).map(({ key, kind, id }) => ({ key, kind, id })) } });
    } else await route.fulfill({ json: { items: entries } });
  });
  for (const [routePath, kind] of [['backgrounds', 'BACKGROUND'], ['music', 'MUSIC']]) await page.route(`**/api/v1/${routePath}`, route => route.fulfill({ json: { items: entries.filter(entry => entry.kind === kind && installed.has(entry.key)).map(entry => ({ id: entry.id, mimeType: entry.mimeType, metadata: { name: entry.name, durationMs: entry.durationMs }, url: `/api/v1/media/${entry.id}` })) } }));
  await page.route('**/api/v1/studio-assets/*/preview', route => route.fulfill({ contentType: 'audio/wav', body: '' }));
  await page.route('**/api/v1/studio-assets/*/thumbnail', route => route.fulfill({ status: 404 }));
  await page.goto(`/studio?video=${videoId}`);
  await expect(page.locator('.studio-catalog')).toHaveJSProperty('open', true);
  await expect(page.getByRole('img', { name: 'Rừng xanh CC0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nhạc không lời (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Nghe thử', exact: true }).click();
  await expect(page.locator('audio[aria-label="Nghe thử First Snow"]')).toHaveAttribute('src', '/api/v1/studio-assets/first-snow/preview');
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Dùng nhạc này', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Nhạc nền', exact: true })).toHaveValue(id(402));
  await expect(page.locator('audio[aria-label="Nghe nhạc nền"]')).toHaveJSProperty('autoplay', true);
  await expect(page.locator('audio[aria-label="Nghe nhạc nền"]')).toHaveJSProperty('volume', 0.15);
  await page.getByRole('button', { name: 'Thêm toàn bộ 2 lựa chọn vào workspace', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ảnh / video nền', exact: true }).getByRole('option', { name: '▶ Rừng xanh CC0' })).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'Nhạc nền', exact: true })).toHaveValue(id(402));
  await page.getByRole('combobox', { name: 'Ảnh / video nền', exact: true }).selectOption(id(401));
  const backgroundPreview = page.locator('video[aria-label="Xem trước nền đang chọn"]');
  await expect(backgroundPreview).toHaveAttribute('src', `/api/v1/media/${id(401)}#t=0`);
  await expect(backgroundPreview).toHaveJSProperty('autoplay', true);
  await expect(backgroundPreview).toHaveJSProperty('muted', true);
  await page.getByRole('combobox', { name: 'Ảnh / video nền', exact: true }).selectOption('');
  await expect(backgroundPreview).toHaveCount(0);
  await page.getByLabel('Tìm nền hoặc nhạc', { exact: true }).fill('no matching song');
  await expect(page.getByText('Không có tài nguyên khớp bộ lọc.', { exact: true })).toBeVisible();
  expect(requests.map(item => item.keys)).toEqual([['first-snow'], ['scene-test', 'first-snow']]);
  expect(requests.every(item => item.key.length > 0 && item.key.length < 200)).toBe(true);
  expect(fixture.mutations).toEqual([]);
});

test('Studio exposes the video library from import and opens a completed MP4 for review', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true });
  await page.goto('/studio?mode=import');
  await page.getByRole('link', { name: 'Video đã tạo & duyệt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Video đã tạo & duyệt', exact: true })).toBeVisible();
  await expect(page.getByText('Chờ duyệt', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Xem & duyệt', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`video=${videoId}#video-review$`));
  const review = page.getByRole('region', { name: 'Xem và duyệt video', exact: true });
  await expect(review.locator('video')).toHaveAttribute('src', `/api/v1/media/${assetId}`);
  const headingBox = await review.boundingBox(); const editorBox = await page.locator('.studio-workspace').boundingBox();
  expect(headingBox!.y).toBeLessThan(editorBox!.y);
  await expect(review.getByRole('button', { name: 'Duyệt video', exact: true })).toBeDisabled();
  await mkdir('../../test-results/studio-product-screenshots', { recursive: true });
  await review.screenshot({ path: '../../test-results/studio-product-screenshots/video-review-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await review.screenshot({ path: '../../test-results/studio-product-screenshots/video-review-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(fixture.mutations).toEqual([]);
});

test('a reviewer can approve a watched MP4 and the decision survives reload', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true, role: 'REVIEWER' });
  await page.goto(`/studio?video=${videoId}`);
  await page.getByRole('checkbox', { name: 'Tôi đã xem video, kiểm tra lời đọc, phụ đề và quyền sử dụng.', exact: true }).check();
  await page.getByRole('button', { name: 'Duyệt video', exact: true }).click();
  await expect(page.locator('#video-review').getByText('Đã duyệt', { exact: true })).toBeVisible();
  expect(fixture.mutations).toHaveLength(1);
  expect(fixture.mutations[0]).toMatchObject({ path: `/videos/${videoId}/reviews`, body: { decision: 'APPROVED' } });
  await page.reload();
  await expect(page.locator('#video-review').getByText('Đã duyệt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duyệt video', exact: true })).toHaveCount(0);
});

test('an editor can preview and download a pending MP4 but cannot record a review decision', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true, role: 'EDITOR' });
  await page.goto(`/studio?video=${videoId}`);
  await expect(page.getByText('Cần chủ workspace, quản trị viên hoặc người duyệt', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duyệt video', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Không duyệt video', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tải MP4 về máy', exact: true })).toHaveAttribute('href', `/api/v1/media/${assetId}?download=1`);
  expect(fixture.mutations).toEqual([]);
});

test('review rejection and failed approval are shown without claiming approval', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true, reviewFailure: true });
  await page.goto(`/studio?video=${videoId}`);
  await page.getByRole('checkbox', { name: 'Tôi đã xem video, kiểm tra lời đọc, phụ đề và quyền sử dụng.', exact: true }).check();
  await page.getByRole('button', { name: 'Duyệt video', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Video chưa vượt qua kiểm tra chất lượng.' })).toBeVisible();
  await expect(page.getByText('Chờ duyệt', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mở bàn giao video →', exact: true })).toHaveCount(0);
  expect(fixture.mutations).toHaveLength(1);
  await page.unroute('**/api/v1/**');
  const rejected = await productFixture(page, { rendered: true });
  await page.reload();
  await page.getByRole('button', { name: 'Không duyệt video', exact: true }).click();
  await expect(page.getByText('Không duyệt', { exact: true })).toBeVisible();
  expect(rejected.mutations[0]).toMatchObject({ path: `/videos/${videoId}/reviews`, body: { decision: 'REJECTED' } });
});

test('Studio explains an empty video library and shows load failures with retry', async ({ page }) => {
  await productFixture(page);
  await page.goto('/studio#studio-videos');
  await expect(page.getByRole('heading', { name: 'Chưa có video để duyệt', exact: true })).toBeVisible();
  await page.route('**/api/v1/videos', route => route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'Không tải được video.' } }));
  await page.getByRole('button', { name: 'Làm mới video', exact: true }).click();
  await expect(page.locator('#studio-videos').getByRole('alert')).toContainText('Không tải được video.');
});

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
  await page.getByRole('combobox', { name: 'Tốc độ đọc', exact: true }).selectOption('1.15');
  await page.getByRole('button', { name: 'Tạo bản nháp kịch bản', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Biên tập kịch bản' })).toBeVisible();
  expect(fixture.mutations.find((entry) => entry.path.endsWith('/produce'))?.body.draftOnly).toBe(true);
  expect(fixture.mutations.find((entry) => entry.path.endsWith('/produce'))?.body.commentIds).toEqual([id(108)]);
  expect(fixture.mutations.some((entry) => entry.path.endsWith('/render'))).toBe(false);
  const hook = page.getByLabel('HOOK text', { exact: true });
  await hook.fill('Một thư viện nhỏ đã gắn kết cả khu phố.');
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Lưu phiên bản' }).click();
  await expect(hook).toHaveValue('Một thư viện nhỏ đã gắn kết cả khu phố.');
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Nghe thử giọng', exact: true }).click();
  await expect(page.getByText('Đang tạo bản nghe thử ngắn với giọng và tốc độ đã chọn. Chưa dựng video.')).toBeVisible();
  expect(fixture.mutations.find((entry) => entry.path.endsWith('/audio'))?.body).toEqual({ voiceProfileId: 'mock-vi', speakingRate: 1.15, preview: true });
  expect(fixture.mutations.some((entry) => entry.path.endsWith('/render'))).toBe(false);
  await mkdir('../../test-results/studio-product-screenshots', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../../test-results/studio-product-screenshots/studio-editor-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Tạo video MP4', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xem và duyệt video', exact: true })).toBeVisible();
  expect(fixture.mutations.find((entry) => entry.path.endsWith('/render'))?.body).toMatchObject({ speakingRate: 1.15, voiceProfileId: 'mock-vi' });
  await expect(page.getByRole('link', { name: 'Tải MP4 về máy', exact: true })).toHaveAttribute('href', `/api/v1/media/${assetId}?download=1`);
  await expect(page.getByRole('button', { name: 'Duyệt video', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Tôi đã xem video, kiểm tra lời đọc, phụ đề và quyền sử dụng.', exact: true }).check();
  await page.getByRole('button', { name: 'Duyệt video', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('BLOCKED_EXTERNAL', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tải MP4', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Xem trong Studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xem và duyệt video', exact: true })).toBeVisible();
  await expect(page.locator('.studio-source strong')).toHaveText('Thư viện nhỏ trong khu phố');
  await expect(page.getByRole('combobox', { name: 'Tốc độ đọc', exact: true })).toHaveValue('1.15');
  await page.locator('.studio-comment-section > summary').click();
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
  await mkdir('../../test-results/studio-product-screenshots', { recursive: true });
  for (const route of ['/dashboard', '/discover', '/studio', '/publish']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `../../test-results/studio-product-screenshots/${route.slice(1)}-desktop.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/dashboard', '/discover', `/studio?posts=${postId}`, '/studio?mode=import', '/publish']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), route).toBe(true);
  }
  await page.goto('/discover');
  await page.screenshot({ path: '../../test-results/studio-product-screenshots/discover-mobile.png', fullPage: true });
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

test('original-image preview, caption settings and presets stay stable without automatic production', async ({ page }) => {
  const fixture = await productFixture(page);
  const image = await readFile('../../examples/source-capture/bea2a6e7cc6b44f3949640349012de1c.png');
  const imageId = id(130); let showMasked = true; let imageGets = 0;
  const sourceImages = () => ({ captured: true, items: (showMasked ? ['ORIGINAL','ANONYMIZED'] : ['ORIGINAL']).map(variant => ({ id: imageId, checksum: 'a'.repeat(64), metadata: { postId, captureRunId: id(131), sourceRef: `post:${postId}`, variant, textHash: 'b'.repeat(64), width: image.readUInt32BE(16), height: image.readUInt32BE(20) } })) });
  await page.route(`**/api/v1/posts/${postId}/source-images`, route => { imageGets++; return route.fulfill({ json: sourceImages() }); });
  await page.route(`**/api/v1/media/${imageId}`, route => route.fulfill({ contentType: 'image/png', body: image }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/discover'); await page.getByRole('button', { name: 'Xem chi tiết →' }).click();
  await page.getByRole('dialog').getByRole('checkbox').check(); await page.getByRole('button', { name: 'Chọn nội dung này', exact: true }).click();
  await page.getByRole('link', { name: 'Tiếp tục trong Studio →' }).click();
  await page.getByRole('button', { name: 'Tạo bản nháp kịch bản', exact: false }).click();
  const preview = page.getByRole('region', { name: 'Xem trước bố cục video' });
  await expect(preview.locator('img')).toHaveAttribute('src', `/api/v1/media/${imageId}`);
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeEnabled();
  const mutationsBefore = fixture.mutations.length; const imageReadsBefore = imageGets;
  await page.getByRole('button', { name: 'Một câu chuyện hay Tô sáng từng từ' }).click();
  await page.getByRole('combobox', { name: 'Cỡ chữ', exact: true }).selectOption('52');
  await page.getByRole('combobox', { name: 'Tốc độ đọc', exact: true }).selectOption('0.85');
  await page.getByRole('button', { name: 'Cảnh 2', exact: true }).click();
  await page.waitForTimeout(1900);
  expect(fixture.mutations).toHaveLength(mutationsBefore); expect(imageGets).toBe(imageReadsBefore);
  await expect(page.getByRole('combobox', { name: 'Cỡ chữ', exact: true })).toHaveValue('52');
  await expect(page.getByRole('combobox', { name: 'Tốc độ đọc', exact: true })).toHaveValue('0.85');
  await page.getByText('Bộ thiết lập của bạn', { exact: true }).click();
  await page.getByLabel('Tên bộ thiết lập', { exact: true }).fill('Giọng kể riêng');
  let savedPreset: Record<string, unknown> | null = null;
  await page.route('**/api/v1/studio-presets', async route => {
    if (route.request().method() === 'POST') { savedPreset = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({ json: { id: id(140) } }); }
    else await route.fulfill({ json: { items: [] } });
  });
  await page.getByRole('button', { name: 'Lưu thiết lập', exact: true }).click();
  await expect(page.getByText('Đã lưu bộ thiết lập trong workspace.', { exact: true })).toBeVisible();
  expect(savedPreset).toMatchObject({ name: 'Giọng kể riêng', settings: { speakingRate: 0.85, mediaSettings: { captionSize: 52 } } });
  expect(JSON.stringify(savedPreset)).not.toContain(postId);
  await mkdir('../../docs/screenshots/studio-maker', { recursive: true });
  await page.screenshot({ path: '../../docs/screenshots/studio-maker/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '../../docs/screenshots/studio-maker/mobile.png', fullPage: true });
  await page.reload();
  showMasked = false;
  await page.goto(`/studio?posts=${postId}&run=${draftId}`);
  await expect(page.getByRole('region', { name: 'Xem trước bố cục video' })).toContainText('Thiếu ảnh');
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeDisabled();
  expect(errors.filter(error => !/media|fetch|network/i.test(error))).toEqual([]);
});

test('long source titles, the detail dialog and the populated editor fit narrow screens', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true, longContent: true });
  await mkdir('../../test-results/ui-layout', { recursive: true });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/discover');
    await page.getByRole('button', { name: 'Xem chi tiết →', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Một câu chuyện dài/ })).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(Math.abs(bounds!.x - (width - bounds!.width) / 2)).toBeLessThan(2);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Đóng chi tiết', exact: true }).click();
    await page.goto(`/studio?posts=${postId}&run=${renderId}`);
    await expect(page.getByRole('heading', { name: 'Thiết lập video', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await page.locator('.studio-edit-column').evaluate(element => element.firstElementChild?.id)).toBe('studio-script');
    await page.getByRole('navigation', { name: 'Các phần biên tập', exact: true }).getByRole('link', { name: 'Kịch bản', exact: true }).click();
    await expect(page).toHaveURL(/#studio-script$/);
    const overflow = await page.locator('main').evaluate(element => [...element.querySelectorAll('input:not([type="hidden"]), select, textarea, button, a.button, summary')].filter(control => control.getClientRects().length > 0 && !control.closest('details:not([open]) > :not(summary), .preview-scenes')).filter(control => {
      const rect = control.getBoundingClientRect();
      return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
    }).map(control => `${control.tagName}: ${control.textContent?.slice(0, 60)}`));
    expect(overflow).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `../../test-results/ui-layout/${width}-studio-editor.png`, fullPage: true });
  }
  expect(fixture.mutations).toEqual([]);
});

test('expanded Studio cards keep help text separated from checkbox rows and form fields', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true });
  await page.route('**/api/v1/voice-profiles', route => route.fulfill({ json: { items: [
    { id: 'mock-vi', name: 'Vietnamese test voice', provider: 'mock', language: 'vi', voiceId: 'vi', requiresCredentials: false },
    { id: 'local-vi', name: 'Giọng local kiểm thử', provider: 'vieneu', language: 'vi', voiceId: 'local', requiresCredentials: false },
  ] } }));
  await mkdir('../../test-results/ui-layout/cards', { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/studio?posts=${postId}&run=${renderId}`);
    await expect(page.getByRole('heading', { name: 'Thiết lập video', exact: true })).toBeVisible();
    for (const name of ['Bố cục và quyền riêng tư', 'Bộ thiết lập của bạn', 'Giọng đọc riêng · VieNeu local', 'Thêm nền hoặc nhạc từ máy']) await page.getByText(name, { exact: true }).click();
    const advanced = page.locator('.studio-advanced');
    await expect(advanced.getByRole('combobox', { name: 'Giao diện thẻ', exact: true })).toBeVisible();
    await advanced.getByRole('combobox', { name: 'Giao diện thẻ', exact: true }).selectOption('light');
    await advanced.getByRole('combobox', { name: 'Phong cách kể', exact: true }).selectOption('SOCIAL_COMMENTARY');
    await advanced.getByRole('checkbox', { name: 'Che tên và avatar trong video', exact: true }).uncheck();
    await expect(advanced).toHaveJSProperty('open', true);
    const measurements = await page.evaluate(() => {
      const gaps: Array<{ card: string; before: string; after: string; gap: number }> = [];
      for (const selector of ['.studio-advanced', '.studio-preset-panel', '.voice-library', '.studio-upload-panel']) {
        const panel = document.querySelector(selector)!;
        const blocks = [...panel.children].filter(element => element.getClientRects().length > 0 && !element.matches('[role="alert"], [role="status"]'));
        for (let index = 1; index < blocks.length; index++) {
          const previous = blocks[index - 1]!, current = blocks[index]!;
          gaps.push({ card: selector, before: previous.tagName, after: current.tagName, gap: current.getBoundingClientRect().top - previous.getBoundingClientRect().bottom });
        }
      }
      const help = document.querySelector('.studio-advanced > .field-help')!;
      const checkbox = document.querySelector('.studio-advanced .checkbox-label:last-of-type')!;
      return { gaps, helpGap: help.getBoundingClientRect().top - checkbox.getBoundingClientRect().bottom };
    });
    expect(measurements.gaps.filter(item => item.gap < 11), `card spacing at ${width}px`).toEqual([]);
    expect(measurements.helpGap).toBeGreaterThanOrEqual(12);
    await advanced.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../../test-results/ui-layout/cards/${width}-advanced.png` });
    for (const selector of ['.studio-preset-panel', '.voice-library', '.studio-upload-panel']) await page.locator(selector).screenshot({ path: `../../test-results/ui-layout/cards/${width}-${selector.slice(1)}.png` });
  }
  expect(fixture.mutations).toEqual([]);
});

test('preset cards explain loading and empty states before saving and applying a setup', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true });
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  let stored: { id: string; name: string; settings: Record<string, unknown> } | null = null;
  let saves = 0;
  await page.route('**/api/v1/studio-presets', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string; settings: Record<string, unknown> };
      stored = { id: id(490), ...body }; saves++;
      await route.fulfill({ json: { id: stored.id } });
    } else { await ready; await route.fulfill({ json: { items: stored ? [stored] : [] } }); }
  });
  try {
    await page.goto(`/studio?posts=${postId}&run=${renderId}`);
    await page.getByText('Bộ thiết lập của bạn', { exact: true }).click();
    const card = page.locator('.studio-preset-panel');
    await expect(card.getByText('Đang tải bộ thiết lập…', { exact: true })).toBeVisible({ timeout: 4000 });
    await expect(card.getByRole('combobox', { name: 'Bộ thiết lập đã lưu', exact: true })).toBeDisabled();
    release();
    await expect(card.getByText('Chưa có bộ thiết lập. Đặt tên và lưu thiết lập hiện tại để dùng lại.', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Áp dụng', exact: true })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Lưu thiết lập', exact: true })).toBeDisabled();
    await card.getByLabel('Tên bộ thiết lập', { exact: true }).fill('Giọng kể buổi tối');
    await card.getByRole('button', { name: 'Lưu thiết lập', exact: true }).click();
    await expect(card.getByText('Đã lưu bộ thiết lập trong workspace.', { exact: true })).toBeVisible();
    await card.getByRole('combobox', { name: 'Bộ thiết lập đã lưu', exact: true }).selectOption(id(490));
    await card.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    await expect(card.getByText('Đã áp dụng Giọng kể buổi tối.', { exact: true })).toBeVisible();
    await mkdir('../../test-results/impeccable', { recursive: true });
    await card.screenshot({ path: '../../test-results/impeccable/preset-saved.png' });
    expect(saves).toBe(1); expect(fixture.mutations).toEqual([]);
  } finally { release(); }
});

test('media upload requires rights evidence and keeps server errors actionable for retry', async ({ page }) => {
  const fixture = await productFixture(page, { rendered: true });
  let attempts = 0; let imported = false;
  await page.route('**/api/v1/backgrounds', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { items: imported ? [{ id: id(491), mimeType: 'image/png', metadata: { name: 'Nền thử local' }, url: `/api/v1/media/${id(491)}` }] : [] } }); return; }
    attempts++;
    expect(route.request().headers()['x-rights-evidence']).toBe(encodeURIComponent('Giấy phép dữ liệu thử'));
    if (attempts === 1) await route.fulfill({ status: 400, json: { code: 'MEDIA_UPLOAD_INVALID', message: 'File không đúng định dạng. Chọn ảnh PNG hoặc video MP4 H.264.' } });
    else { imported = true; await route.fulfill({ json: { id: id(491) } }); }
  });
  await page.goto(`/studio?posts=${postId}&run=${renderId}`);
  await page.getByText('Thêm nền hoặc nhạc từ máy', { exact: true }).click();
  const card = page.locator('.studio-upload-panel');
  await card.getByLabel('File từ máy', { exact: true }).setInputFiles({ name: 'local-background.png', mimeType: 'image/png', buffer: Buffer.from('fixture file rejected by mocked validation') });
  await card.getByLabel('Tên hiển thị', { exact: true }).fill('Nền thử local');
  await card.getByRole('combobox', { name: 'Quyền sử dụng', exact: true }).selectOption('LICENSED');
  const evidence = card.getByRole('textbox', { name: 'Bằng chứng quyền', exact: true });
  await expect(evidence).toHaveJSProperty('required', true);
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Tải lên và chọn', exact: true }).click();
  await expect(evidence).toBeFocused(); expect(attempts).toBe(0);
  await evidence.fill('Giấy phép dữ liệu thử');
  await card.getByRole('button', { name: 'Tải lên và chọn', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('File không đúng định dạng. Chọn ảnh PNG hoặc video MP4 H.264.');
  expect(await card.evaluate(element => element.querySelector('[role="alert"]')!.getBoundingClientRect().top - element.querySelector(':scope > .field-help')!.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(12);
  await expect(card.getByLabel('Tên hiển thị', { exact: true })).toHaveValue('Nền thử local');
  await expect(evidence).toHaveValue('Giấy phép dữ liệu thử');
  await mkdir('../../test-results/impeccable', { recursive: true });
  await card.screenshot({ path: '../../test-results/impeccable/upload-error.png' });
  await card.getByRole('button', { name: 'Tải lên và chọn', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Đã tải lên và chọn cho video.');
  await expect(card.getByRole('combobox', { name: 'Quyền sử dụng', exact: true })).toHaveValue('OWNED');
  await expect(evidence).toHaveJSProperty('required', false);
  await expect(card.getByLabel('Tên hiển thị', { exact: true })).toHaveValue('');
  expect(attempts).toBe(2); expect(fixture.mutations).toEqual([]);
});

test('reviewed local import continues in the shared Studio instead of a second export form', async ({ page }) => {
  const fixture = await productFixture(page);
  await page.goto('/discover'); await page.getByRole('button', { name: 'Xem chi tiết →' }).click();
  await page.getByRole('dialog').getByRole('checkbox').check(); await page.getByRole('button', { name: 'Chọn nội dung này', exact: true }).click();
  await page.evaluate(({ postId, channelId }) => sessionStorage.setItem('shorts-factory:local-export:owner-1:workspace-1', JSON.stringify({ keys: {}, postId, channelId })), { postId, channelId });
  await page.goto('/studio?mode=import');
  await expect(page.getByText('Đã nhập và duyệt nguồn.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Thiết lập video', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3. Tạo video local', exact: true })).toHaveCount(0);
  expect(fixture.mutations.some(entry => entry.path.endsWith('/produce'))).toBe(false);
});
