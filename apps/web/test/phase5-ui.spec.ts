import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { channelId, mockWorkspace } from './fixtures/workspace';

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
