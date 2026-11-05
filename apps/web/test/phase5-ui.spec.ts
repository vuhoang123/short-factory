import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { channelId, mockWorkspace } from './fixtures/workspace';

test('channel rules, pause, dry run and approval inbox use real request contracts', async ({ page }) => {
  const { mutations } = await mockWorkspace(page);
  await page.goto('/autopilot');
  await expect(page.getByRole('heading', { name: 'Tự động hóa nội dung', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Kênh nội dung', exact: true })).toHaveValue(channelId);
  await page.getByLabel('Điểm tối thiểu để chọn bài', { exact: true }).fill('65');
  await page.getByRole('button', { name: 'Lưu phiên bản quy tắc', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('new rule version');
  expect(mutations.find((item) => item.path.endsWith('/automation'))?.body).toMatchObject({ expectedVersion: 1, config: { minScore: 65, voiceProfileId: 'mock-vi', requireApproval: true } });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chạy thử', exact: true }).click();
  await page.getByText('Kết quả chạy thử và các điều kiện', { exact: true }).click();
  await expect(page.getByText('HUMAN_REVIEW_REQUIRED', { exact: false })).toBeVisible();
  expect(mutations.find((item) => item.path.endsWith('/automation/run'))?.body).toEqual({ dryRun: true });
  await page.getByRole('button', { name: /Community stories.*APPROVAL GATE/i }).click();
  await expect(page.getByText('QUALITY VALIDATION', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Không duyệt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chưa có video chờ duyệt', exact: true })).toBeVisible();
  expect(mutations.some((item) => item.path === '/videos/video-1/reviews')).toBe(true);
  await mkdir('test-results/phase5-ui', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/phase5-ui/autopilot-fixture.png', fullPage: true });
});

test('analytics preserves missing metrics and records deliberate recommendation and experiment decisions', async ({ page }) => {
  const { mutations } = await mockWorkspace(page);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Số liệu và cải thiện', exact: true })).toBeVisible();
  await expect(page.getByText('Analytics data is stale or has not been collected.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chưa có số liệu quan sát', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Số liệu biểu đồ', exact: true }).selectOption('produced');
  await expect(page.getByRole('img', { name: 'Số video đã tạo theo thời gian. Số liệu thiếu được để trống.' })).toBeVisible();
  await page.getByRole('cell', { name: 'Làm mới số liệu', exact: true }).getByRole('button', { name: 'Làm mới số liệu', exact: true }).click();
  expect(mutations.some((item) => item.path === '/analytics/publications/publication-1/refresh')).toBe(true);
  await page.getByText('Nhập số liệu thủ công', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Bài đã đăng', exact: true }).selectOption('publication-1');
  await page.getByLabel('Lượt xem', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Lưu số liệu thủ công', exact: true }).click();
  expect(mutations.find((item) => item.path.endsWith('/metrics'))?.body).toMatchObject({ views: 0, likes: null, shares: null });
  await page.getByRole('combobox', { name: 'Lịch sử bài đăng', exact: true }).selectOption('publication-1');
  await expect(page.getByRole('heading', { name: 'Chưa có lịch sử số liệu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chấp nhận đề xuất', exact: true }).click();
  await expect(page.getByText('accepted', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Duyệt thử nghiệm', exact: true }).click();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Template comparison', exact: true }).selectOption('approved-video-1');
  await page.getByRole('button', { name: 'Phân bổ vào phương án', exact: true }).click();
  expect(mutations.find((item) => item.path.endsWith('/assign'))?.body).toEqual({ videoId: 'approved-video-1' });
  await mkdir('test-results/phase5-ui', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/phase5-ui/analytics-fixture.png', fullPage: true });
});

test('discovery topic rules stay loaded without repeatedly refetching and flashing', async ({ page }) => {
  const { topicRuleRequests } = await mockWorkspace(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Quy tắc chọn nội dung', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Giật kinh hồn', exact: true })).toBeVisible();
  await expect(page.getByText('Loading topic rules…')).toHaveCount(0);
  const stableRequestCount = topicRuleRequests();
  await page.waitForTimeout(1200);
  expect(topicRuleRequests()).toBe(stableRequestCount);
});
