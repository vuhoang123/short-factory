import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import sourceCaptureFixture from '../../../examples/source-capture/capture.json';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';
const postId = '33333333-3333-4333-8333-333333333333';
const candidateId = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
const videoId = '66666666-6666-4666-8666-666666666666';
const assetId = '77777777-7777-4777-8777-777777777777';
const storyProjectId = '88888888-8888-4888-8888-888888888888';
const commentIds = ['99999999-9999-4999-8999-999999999991', '99999999-9999-4999-8999-999999999992', '99999999-9999-4999-8999-999999999993'];
const now = '2026-10-28T10:00:00.000Z';

async function mockExport(page: Page, options: { capture?: boolean; deduplicated?: boolean; belowThreshold?: boolean; loseFirstProduceResponse?: boolean; role?: 'OWNER' | 'EDITOR' | 'VIEWER'; history?: boolean; historyError?: boolean } = {}) {
  const mutations: Array<{ path: string; body: unknown; key: string | undefined }> = [];
  let rightsStatus = options.history ? 'APPROVED' : 'PENDING';
  let candidateStatus = options.history ? 'APPROVED' : options.belowThreshold ? 'BELOW_THRESHOLD' : 'NEEDS_RIGHTS_REVIEW';
  let videoStatus = 'PENDING';
  let runStatus = options.history ? 'RUNNING' : 'SUCCEEDED';
  let produceRequests = 0;
  let capturePolls = 0;
  const captureId = '11111111-2222-4222-8222-111111111111';
  const savedComments = commentIds.map((id, index) => ({ id, externalId: `c${index + 1}`, body: `Bình luận đã lưu ${index + 1}.`, likes: 100 - index, sensitiveFlags: [] }));
  const savedPost = () => ({ id: postId, title: 'Câu chuyện đã lưu', body: 'Nội dung thực tế trong cơ sở dữ liệu.', canonicalUrl: 'https://www.facebook.com/example/posts/123', platform: 'MANUAL', externalPostId: 'manual-123', discoveredAt: now, sensitiveFlags: [],
    rights: [{ id: 'right-1', basis: options.capture && rightsStatus === 'PENDING' ? 'UNKNOWN' : 'OWNED', reviewStatus: rightsStatus, attested: true, commercialAllowed: true, allowedPlatforms: ['FACEBOOK'], territory: 'VN', attributionRequired: false, evidence: null }], comments: savedComments });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace('/api/v1', '');
    if (request.method() === 'POST') {
      const body: unknown = request.postDataJSON(); mutations.push({ path, body, key: request.headers()['idempotency-key'] });
      if (path === '/source-captures/browser') { await route.fulfill({ json: { opened: true } }); return; }
      if (path === '/source-captures') { await route.fulfill({ json: { id: captureId, status: 'QUEUED' } }); return; }
      if (path === '/imports/manual') { await route.fulfill({ json: { postId, deduplicated: options.deduplicated ?? false, warnings: [] } }); return; }
      if (path.endsWith('/rights/review')) { rightsStatus = 'APPROVED'; if (!options.belowThreshold) candidateStatus = 'PENDING_REVIEW'; await route.fulfill({ json: { postId, reviewStatus: rightsStatus } }); return; }
      if (path === `/candidates/${candidateId}/review`) { candidateStatus = 'APPROVED'; await route.fulfill({ json: { id: candidateId, status: candidateStatus } }); return; }
      if (path.endsWith('/produce')) {
        produceRequests += 1;
        if (options.loseFirstProduceResponse && produceRequests === 1) { await route.abort('failed'); return; }
        await route.fulfill({ json: { runId, storyProjectId, status: 'QUEUED' } }); return;
      }
      if (path.endsWith('/reviews')) { videoStatus = 'APPROVED'; await route.fulfill({ json: { videoId, status: videoStatus, reviewStatus: videoStatus } }); return; }
      if (path === `/production-runs/${runId}/cancel`) { runStatus = 'CANCELLED'; await route.fulfill({ json: { runId, status: 'CANCELLED' } }); return; }
      await route.fulfill({ status: 400, json: { code: 'UNEXPECTED_MUTATION', message: path } }); return;
    }
    const captureComplete = path === `/source-captures/${captureId}` ? ++capturePolls > 1 : capturePolls > 1;
    const data: Record<string, unknown> = {
      [`/source-captures/${captureId}`]: { id: captureId, status: captureComplete ? 'SUCCEEDED' : 'RUNNING', errorCode: null, output: captureComplete ? { postId, warnings: [], scannedComments: 10, capturedComments: 3 } : null },
      [`/posts/${postId}/source-images`]: { items: options.capture ? [{ id: assetId, metadata: { postId, captureRunId: captureId, sourceRef: `post:${postId}`, variant: 'ANONYMIZED', textHash: 'a'.repeat(64), width: 650, height: 554 } }] : [] },
      '/auth/me': { user: { id: 'owner-1', email: 'local@example.org', name: 'Local owner' }, workspaces: [{ id: workspaceId, name: 'Local fixture', role: options.role ?? 'OWNER' }], activeWorkspaceId: workspaceId },
      '/channels': { items: [{ id: channelId, name: 'Kênh local', language: 'vi', minimumCandidateScore: 55 }] },
      '/voice-profiles': { items: [{ id: 'local:vi', name: 'Giọng Việt local', provider: 'local', language: 'vi', requiresCredentials: false }, { id: 'openai:alloy', name: 'Paid provider voice', provider: 'openai', language: 'multilingual', requiresCredentials: true }] },
      [`/posts/${postId}`]: savedPost(), [`/posts/${postId}/comments`]: { items: savedComments },
      [`/posts/${postId}/comment-selection`]: { items: savedComments, targetCount: 5, availableCount: 3, reactionsKnown: 3, selectionBasis: 'REACTIONS' },
      '/candidates': { items: [{ id: candidateId, score: options.belowThreshold ? 20 : 80, minimumScore: 55, status: candidateStatus, factors: null, modelVersion: 'heuristic-v1', reasoning: null, eligibility: null, post: savedPost() }] },
      [`/production-runs/${runId}`]: { id: runId, storyProjectId, sourcePostId: postId, channelId, title: 'Câu chuyện đã lưu', status: runStatus, attempts: 1, currentStage: 'VIDEO_RENDER', errorCode: runStatus === 'CANCELLED' ? 'USER_CANCELLED' : null, input: { channelId, voiceProfileId: 'local:vi', targetDurationSec: 40, commentIds }, story: { id: storyProjectId, post: { id: postId }, channelId }, stages: [{ name: 'VIDEO_RENDER', status: runStatus === 'SUCCEEDED' ? 'SUCCEEDED' : 'RUNNING', errorCode: null }], renderJob: { progress: runStatus === 'SUCCEEDED' ? 1 : 0.4 }, videos: runStatus === 'SUCCEEDED' ? [{ id: videoId, mediaAsset: { id: assetId } }] : [] },
      [`/videos/${videoId}`]: { id: videoId, title: 'Video local fixture', status: videoStatus === 'PENDING' ? 'READY_FOR_REVIEW' : 'APPROVED', reviewStatus: videoStatus, durationMs: 40_000, mediaAsset: { id: assetId, mimeType: 'video/mp4' } },
    };
    if (path === '/production-runs') {
      if (options.historyError) { await route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'Không tải được lịch sử.' } }); return; }
      const summary = { id: runId, storyProjectId, sourcePostId: postId, channelId, title: 'Câu chuyện đã lưu', status: runStatus, attempts: 1, currentStage: 'VIDEO_RENDER', errorCode: runStatus === 'CANCELLED' ? 'USER_CANCELLED' : null, createdAt: now, startedAt: now, completedAt: null, renderJob: { progress: 0.4, status: runStatus }, videos: [] };
      const failed = { ...summary, id: '55555555-5555-4555-8555-555555555556', title: 'Lượt hết thời gian', status: 'FAILED_RETRYABLE', errorCode: 'MEDIA_RENDER_TIMEOUT' };
      const items = !options.history ? [] : url.searchParams.get('cursor') || url.searchParams.get('status') === 'FAILED_RETRYABLE' ? [failed] : [summary];
      await route.fulfill({ json: { items, nextCursor: options.history && !url.searchParams.get('cursor') && !url.searchParams.get('status') ? runId : null } }); return;
    }
    if (path === '/candidates') expect(url.searchParams.get('sourcePostId')).toBe(postId);
    if (path.startsWith('/media/')) { await route.fulfill(options.capture ? { contentType: 'image/png', body: readFileSync(`../../examples/source-capture/${sourceCaptureFixture.anonymous_image_id}.png`) } : { status: 200, contentType: 'video/mp4', body: '' }); return; }
    await route.fulfill({ json: data[path] ?? { items: [] } });
  });
  return mutations;
}

async function fillImport(page: Page) {
  await page.goto('/export');
  await page.getByLabel('Link bài Facebook/Threads', { exact: true }).fill('https://www.facebook.com/example/posts/123');
  await page.getByLabel('Tiêu đề', { exact: true }).fill('Bản nháp mới');
  await page.getByLabel('Nội dung bài', { exact: true }).fill('Nội dung tôi vừa dán, khác bản đã lưu.');
  await page.getByLabel('Nhập cả khối bình luận', { exact: true }).fill('Một.\nHai.\nBa.');
  await page.getByRole('combobox', { name: 'Cơ sở quyền sử dụng' }).selectOption('OWNED');
  await page.getByLabel('Phạm vi lãnh thổ', { exact: true }).fill('VN');
  await page.getByRole('checkbox', { name: 'FACEBOOK', exact: true }).check();
  await page.getByLabel('Quyền sử dụng cho phép tạo video', { exact: false }).check();
  await page.getByLabel('Tôi có thẩm quyền nhập', { exact: false }).check();
  await page.getByRole('button', { name: 'Lưu bài để kiểm tra', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2. Kiểm tra bản lưu và duyệt' })).toBeVisible();
}

test('local export uses explicit source and candidate reviews, survives retry/reload and downloads only local media', async ({ page }) => {
  const mutations = await mockExport(page, { loseFirstProduceResponse: true });
  await fillImport(page);
  expect(mutations[0]?.body).toMatchObject({ platform: 'MANUAL', canonicalUrl: 'https://www.facebook.com/example/posts/123', comments: [{ externalId: 'c1', body: 'Một.' }, { externalId: 'c2', body: 'Hai.' }, { externalId: 'c3', body: 'Ba.' }] });
  await expect(page.getByRole('button', { name: 'Duyệt quyền bản lưu' })).toBeDisabled();
  await page.getByLabel('Tôi đã đọc bản lưu', { exact: false }).check();
  await page.getByRole('button', { name: 'Duyệt quyền bản lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận chọn bài', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeEnabled();
  await expect(page.locator('#export-production-blockers')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tạo video MP4', exact: true }).click();
  await expect(page.locator('.notice.error')).toBeVisible();
  await page.getByRole('button', { name: 'Tạo video MP4', exact: true }).click();
  await expect(page.getByRole('heading', { name: '4. Xem và tải video' })).toBeVisible();
  const produce = mutations.filter((item) => item.path.endsWith('/produce'));
  expect(produce).toHaveLength(2); expect(produce[0]?.key).toBe(produce[1]?.key);
  expect(produce[1]?.body).toMatchObject({ channelId, voiceProfileId: 'local:vi', commentIds });
  const stored = await page.evaluate(() => sessionStorage.getItem(`shorts-factory:local-export:owner-1:11111111-1111-4111-8111-111111111111`));
  expect(stored).toContain(runId); expect(stored).not.toContain('Nội dung');
  await page.reload();
  await expect(page.getByRole('heading', { name: '4. Xem và tải video' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duyệt video', exact: true })).toBeDisabled();
  await page.getByLabel('Tôi đã xem video', { exact: false }).check();
  await page.getByRole('button', { name: 'Duyệt video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Duyệt video', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tải MP4 về máy', exact: true })).toHaveAttribute('href', `/api/v1/media/${assetId}?download=1`);
  expect(mutations.some((item) => item.path.startsWith('/publications'))).toBe(false);
});

test('browser capture resumes after reload, previews the actual masked image and requires a rights declaration', async ({ page }) => {
  const mutations = await mockExport(page, { capture: true });
  await page.goto('/export');
  const capture = page.getByRole('button', { name: 'Đã đăng nhập · Chụp bài và bình luận', exact: true });
  await expect(capture).toBeDisabled();
  await page.getByLabel('Link để chụp ảnh gốc').fill('https://www.facebook.com/share/p/owned-fixture/');
  await page.getByRole('button', { name: 'Mở trình duyệt đăng nhập', exact: true }).click();
  await expect(capture).toBeEnabled(); await capture.click();
  await expect(page.getByText('Đang đọc nội dung và chụp ảnh gốc…', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '2. Kiểm tra bản lưu và duyệt' })).toBeVisible();
  await expect(page.getByAltText('Ảnh chụp bài gốc')).toBeVisible();
  const rights = page.getByRole('button', { name: 'Lưu và duyệt quyền bản chụp', exact: true });
  await expect(rights).toBeDisabled();
  await page.getByLabel('Tôi đã đọc bản lưu', { exact: false }).check();
  await page.getByRole('combobox', { name: 'Cơ sở quyền', exact: true }).selectOption('OWNED');
  await page.getByLabel('Bằng chứng / mô tả quyền', { exact: true }).fill('Original synthetic UI test fixture.');
  await page.getByLabel('Lãnh thổ', { exact: true }).fill('WORLDWIDE');
  await page.getByRole('checkbox', { name: 'FACEBOOK', exact: true }).check();
  await page.getByLabel('Quyền cho phép sử dụng thương mại', { exact: false }).check();
  await page.getByLabel('Tôi xác nhận phạm vi quyền', { exact: false }).check();
  await rights.click();
  await page.getByRole('button', { name: 'Xác nhận chọn bài', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeEnabled();
  await page.screenshot({ path: '../../test-results/local-export-browser/source-capture-review.png', fullPage: true });
  expect(mutations.filter(item => item.path === '/source-captures')).toHaveLength(1);
  expect(mutations.some(item => item.path === '/imports/manual')).toBe(false);
});

test('history resumes a durable run without browser progress and cancellation requires an explicit confirmation', async ({ page }) => {
  const mutations = await mockExport(page, { history: true });
  await page.goto('/export');
  await expect(page.getByRole('heading', { name: 'Lịch sử tạo video', exact: true })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Câu chuyện đã lưu' });
  await row.getByRole('button', { name: 'Mở lượt tạo', exact: true }).click();
  await expect(page.getByText(`Mã lượt tạo: ${runId}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Giọng đọc local')).toHaveValue('local:vi');
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hủy lượt tạo', exact: true }).click();
  expect(mutations).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Xác nhận hủy', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../test-results/local-export-browser/phase6-history-cancel.png', fullPage: true });
  await page.getByRole('button', { name: 'Giữ lượt tạo', exact: true }).click();
  expect(mutations).toHaveLength(0);
  await page.getByRole('button', { name: 'Hủy lượt tạo', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận hủy', exact: true }).click();
  await expect(page.getByText('Đã hủy lượt tạo. Worker sẽ dừng xử lý và không tạo thêm video từ lượt này.', { exact: true })).toBeVisible();
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toMatchObject({ path: `/production-runs/${runId}/cancel`, body: {} });
  expect(mutations[0]?.key).toBeTruthy();
  await page.reload();
  await expect(page.getByText(`Mã lượt tạo: ${runId}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hủy lượt tạo', exact: true })).toHaveCount(0);
});

test('local import can create a script draft before opening voice preview in Studio', async ({ page }) => {
  const mutations = await mockExport(page);
  await fillImport(page);
  await page.getByLabel('Tôi đã đọc bản lưu', { exact: false }).check();
  await page.getByRole('button', { name: 'Duyệt quyền bản lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận chọn bài', exact: true }).click();
  await page.getByRole('button', { name: 'Soạn kịch bản để nghe thử trước', exact: true }).click();
  await expect.poll(() => mutations.some(item => item.path.endsWith('/produce'))).toBe(true);
  const request = mutations.find((item) => item.path.endsWith('/produce'));
  expect(request?.body).toMatchObject({ draftOnly: true, targetDurationSec: 40 });
  await expect(page.getByRole('link', { name: 'Mở kịch bản và nghe thử →', exact: true })).toHaveAttribute('href', new RegExp(`run=${runId}`));
  expect(mutations.some((item) => item.path.endsWith('/render'))).toBe(false);
});

test('history paginates and filters timeout runs, while viewers cannot cancel', async ({ page }) => {
  const mutations = await mockExport(page, { history: true, role: 'VIEWER' });
  await page.goto('/export');
  await page.getByRole('button', { name: 'Lượt cũ hơn', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Lượt hết thời gian' })).toBeVisible();
  await expect(page.getByText('Render vượt thời gian cho phép. Người quản trị có thể thử lại sau khi kiểm tra tài nguyên.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lượt mới hơn', exact: true }).click();
  await page.getByLabel('Trạng thái lượt tạo', { exact: true }).selectOption('FAILED_RETRYABLE');
  await expect(page.getByRole('row').filter({ hasText: 'Lượt hết thời gian' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lượt cũ hơn', exact: true })).toBeDisabled();
  await page.getByLabel('Trạng thái lượt tạo', { exact: true }).selectOption('');
  await page.getByRole('row').filter({ hasText: 'Câu chuyện đã lưu' }).getByRole('button', { name: 'Mở lượt tạo', exact: true }).click();
  await expect(page.getByText(`Mã lượt tạo: ${runId}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hủy lượt tạo', exact: true })).toHaveCount(0);
  expect(mutations).toHaveLength(0);
});

test('history errors are visible without preventing a new local import', async ({ page }) => {
  await mockExport(page, { historyError: true });
  await page.goto('/export');
  await expect(page.getByText('Không tải được lịch sử.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lưu bài để kiểm tra', exact: true })).toBeEnabled();
});

test('duplicate imports display canonical saved content and cannot bypass channel score gates', async ({ page }) => {
  const mutations = await mockExport(page, { deduplicated: true, belowThreshold: true });
  await fillImport(page);
  await expect(page.getByText('Bài đã tồn tại.', { exact: false })).toBeVisible();
  await expect(page.getByText('Nội dung thực tế trong cơ sở dữ liệu.', { exact: true })).toBeVisible();
  await expect(page.getByText('Nội dung tôi vừa dán, khác bản đã lưu.', { exact: true })).toHaveCount(0);
  await page.getByLabel('Tôi đã đọc bản lưu', { exact: false }).check();
  await page.getByRole('button', { name: 'Duyệt quyền bản lưu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xác nhận chọn bài', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tạo video MP4', exact: true })).toBeDisabled();
  await expect(page.locator('#export-production-blockers')).toContainText('Bài đạt 20 điểm, thấp hơn ngưỡng 55 của kênh.');
  expect(mutations.some((item) => item.path === `/candidates/${candidateId}/review` || item.path.endsWith('/produce'))).toBe(false);
});

test('mobile editor can import but cannot approve, and local export does not offer paid voices', async ({ page }) => {
  const mutations = await mockExport(page, { role: 'EDITOR' });
  await page.setViewportSize({ width: 390, height: 844 });
  await fillImport(page);
  await page.getByLabel('Tôi đã đọc bản lưu', { exact: false }).check();
  await expect(page.getByRole('button', { name: 'Duyệt quyền bản lưu', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Xác nhận chọn bài', exact: true })).toBeDisabled();
  await expect(page.getByRole('option', { name: 'Paid provider voice' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../../test-results/local-export-browser/phase6-mobile.png', fullPage: true });
  expect(mutations).toHaveLength(1);
});

test('batch file import keeps reactions and automatically chooses ten comments for a two-minute video', async ({ page }) => {
  const mutations = await mockExport(page);
  const ranked = Array.from({ length: 12 }, (_, index) => ({ id: `99999999-9999-4999-8999-${String(index).padStart(12, '0')}`, externalId: `rank-${index}`, body: `Bình luận xếp hạng ${index}`, likes: 120 - index, sensitiveFlags: [] }));
  await page.route(`**/api/v1/posts/${postId}/comments?**`, (route) => route.fulfill({ json: { items: ranked } }));
  await page.route(`**/api/v1/posts/${postId}/comment-selection?**`, (route) => {
    const count = new URL(route.request().url()).searchParams.get('duration') === '120' ? 10 : 5;
    return route.fulfill({ json: { items: ranked.slice(0, count), targetCount: count, availableCount: 12, reactionsKnown: 12, selectionBasis: 'REACTIONS' } });
  });
  await page.goto('/export');
  await page.getByLabel('Link bài Facebook/Threads', { exact: true }).fill('https://www.facebook.com/example/posts/123');
  await page.getByLabel('Nội dung bài', { exact: true }).fill('Nội dung tôi có quyền sử dụng.');
  const supplied = JSON.stringify(ranked.map(({ body, likes }) => ({ body, likes })));
  await page.getByLabel('Hoặc mở file bình luận (.json / .txt / .tsv)', { exact: true }).setInputFiles({ name: 'comments.json', mimeType: 'application/json', buffer: Buffer.from(supplied) });
  await expect(page.getByRole('textbox', { name: 'Nhập cả khối bình luận', exact: true })).toHaveValue(supplied);
  await page.getByRole('combobox', { name: 'Cơ sở quyền sử dụng', exact: true }).selectOption('OWNED');
  await page.getByLabel('Phạm vi lãnh thổ', { exact: true }).fill('VN');
  await page.getByLabel('FACEBOOK', { exact: true }).check();
  await page.getByLabel('Quyền sử dụng cho phép tạo video', { exact: false }).check();
  await page.getByLabel('Tôi có thẩm quyền nhập', { exact: false }).check();
  await page.getByRole('button', { name: 'Lưu bài để kiểm tra', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2. Kiểm tra bản lưu và duyệt', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Độ dài mục tiêu', exact: true }).selectOption('120');
  await expect(page.getByText('Mục tiêu 120s:', { exact: false })).toContainText('ưu tiên 10');
  await expect(page.locator('.comment-picker input:checked')).toHaveCount(10);
  await page.getByLabel('Tôi đã đọc bản lưu', { exact: false }).check();
  await page.getByRole('button', { name: 'Duyệt quyền bản lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận chọn bài', exact: true }).click();
  await page.getByRole('button', { name: 'Tạo video MP4', exact: true }).click();
  await expect(page.getByRole('heading', { name: '4. Xem và tải video', exact: true })).toBeVisible();
  expect(mutations.find((entry) => entry.path.endsWith('/produce'))?.body).toMatchObject({ targetDurationSec: 120, commentSelection: 'TOP_REACTIONS', commentIds: ranked.slice(0, 10).map((comment) => comment.id) });
});

test('a speaker-attested local voice upload is selected after the voice library reloads', async ({ page }) => {
  await mockExport(page);
  let uploaded = false;
  const voiceId = 'vieneu:custom:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await page.route('**/api/v1/voice-profiles', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-voice-consent']).toBe('true');
      expect(decodeURIComponent(route.request().headers()['x-voice-name'] ?? '')).toBe('Giọng của tôi');
      expect(route.request().headers()['content-type']).toBe('audio/wav');
      uploaded = true;
      await route.fulfill({ status: 201, json: { id: voiceId, name: 'Giọng của tôi' } }); return;
    }
    await route.fulfill({ json: { items: [{ id: 'vieneu:narrator', name: 'Giọng kể chuyện neural', provider: 'vieneu', language: 'vi', requiresCredentials: false }, ...(uploaded ? [{ id: voiceId, name: 'Giọng của tôi · giọng riêng', provider: 'vieneu', language: 'vi', requiresCredentials: false }] : [])] } });
  });
  await fillImport(page);
  await page.getByText('Giọng đọc riêng · VieNeu local', { exact: true }).click();
  await page.getByLabel('Tên giọng riêng', { exact: true }).fill('Giọng của tôi');
  await page.getByLabel('Mẫu giọng WAV', { exact: true }).setInputFiles({ name: 'reference.wav', mimeType: 'audio/wav', buffer: Buffer.from('Synthetic upload fixture; actual PCM validation is covered by API and neural smoke tests.') });
  await page.getByLabel('Đây là giọng của tôi', { exact: false }).check();
  await page.getByRole('button', { name: 'Lưu và chọn giọng riêng', exact: true }).click();
  await expect(page.getByText('Đã lưu và chọn giọng riêng.', { exact: false })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Giọng đọc local', exact: true })).toHaveValue(voiceId);
});
