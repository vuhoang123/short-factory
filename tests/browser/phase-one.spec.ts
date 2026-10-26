import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '../../packages/database/src/index';

const runId = randomBytes(6).toString('hex');
const email = `editorial-qa-${runId}@example.test`;
const password = randomBytes(24).toString('base64url');
const primaryName = `Editorial QA ${runId}`;
const otherName = `Isolated QA ${runId}`;
const storyTitle = 'A neighborhood library finds a new home';
const workspaceIds: string[] = [];
let userId: string | undefined;
let savedSession: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;

const importedStory = {
  platform: 'MANUAL',
  externalPostId: `qa-story-${runId}`,
  canonicalUrl: 'https://example.org/owned-community-story',
  title: storyTitle,
  body: 'Our neighborhood opened a free book exchange in a shared community space. This is an original synthetic test story written for Shorts Factory quality assurance.',
  comments: [
    { externalId: 'qa-c1', body: 'We contributed a shelf of books. This is an authorized synthetic test comment.' },
    { externalId: 'qa-c2', body: 'The reading group now meets every Saturday. This is an authorized synthetic test comment.' },
    { externalId: 'qa-c3', body: 'The space is maintained by volunteers. This is an authorized synthetic test comment.' },
  ],
  rights: {
    basis: 'OWNED',
    commercialAllowed: true,
    allowedPlatforms: ['YOUTUBE', 'FACEBOOK'],
    attested: false,
    evidence: 'Original synthetic text and comments authored exclusively for this local quality assurance test.',
    territory: 'WORLDWIDE',
  },
};

test.describe.serial('Phase 1 editorial workspace', () => {
  test.afterAll(async () => {
    const db = new PrismaClient({ log: [] });
    try {
      const createdUser = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (!createdUser || (userId && createdUser.id !== userId)) return;
      const exactUserId = createdUser.id;
      const ownedWorkspaces = await db.workspace.findMany({ where: { slug: { in: [`editorial-qa-${runId}`, `isolated-qa-${runId}`] }, members: { some: { userId: exactUserId, role: 'OWNER' } } }, select: { id: true } });
      const exactWorkspaceIds = [...new Set([...workspaceIds, ...ownedWorkspaces.map((workspace) => workspace.id)])];
      await db.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: exactUserId } });
        if (exactWorkspaceIds.length) await tx.workspace.deleteMany({ where: { id: { in: exactWorkspaceIds }, members: { some: { userId: exactUserId, role: 'OWNER' } } } });
        await tx.user.deleteMany({ where: { id: exactUserId, email } });
      });
    } finally { await db.$disconnect(); }
  });

  test('register, import, deduplicate, review rights and isolate workspaces', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Editorial QA');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your workspace', exact: true })).toBeVisible();

    const signedIn = await page.request.get('/api/v1/auth/me');
    expect(signedIn.ok()).toBe(true);
    const identity: { user: { id: string } } = await signedIn.json();
    userId = identity.user.id;

    await page.getByLabel('Workspace name', { exact: true }).fill(primaryName);
    await page.getByLabel('Workspace slug', { exact: true }).fill(`editorial-qa-${runId}`);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspace overview', exact: true })).toBeVisible();
    const firstSession: { activeWorkspaceId: string } = await (await page.request.get('/api/v1/auth/me')).json();
    workspaceIds.push(firstSession.activeWorkspaceId);

    await page.getByRole('link', { name: 'Content channels', exact: true }).click();
    await page.getByLabel('Channel name', { exact: true }).fill('Community stories');
    await page.getByLabel('Topic keywords', { exact: true }).fill('community, books, everyday life');
    await page.getByRole('button', { name: 'Create channel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Community stories', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await page.getByLabel('Source identifier', { exact: true }).fill(`owned-story-archive-${runId}`);
    await page.getByRole('button', { name: 'Register source', exact: true }).click();
    await expect(page.getByText(`owned-story-archive-${runId}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'available', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Post library', exact: true }).click();
    await page.getByLabel('Import JSON', { exact: true }).fill(JSON.stringify(importedStory, null, 2));
    await page.getByLabel('I confirm I have authority to import this post and its comments. Public visibility alone does not grant reuse rights.', { exact: true }).check();
    await page.getByRole('button', { name: 'Import story', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Story and comments imported' })).toBeVisible();
    await expect(page.getByRole('cell', { name: storyTitle })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'pending owned' })).toBeVisible();

    await page.getByLabel('I confirm I have authority to import this post and its comments. Public visibility alone does not grant reuse rights.', { exact: true }).check();
    await page.getByRole('button', { name: 'Import story', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'No duplicate was created' })).toBeVisible();
    await expect(page.getByRole('cell', { name: storyTitle })).toHaveCount(1);

    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Source comments', exact: true })).toBeVisible();
    await expect(page.locator('.comment-list li')).toHaveCount(3);
    await expect(page.getByText('YouTube rights check: blocked', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Rights reviews', exact: true }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await page.getByLabel('Verified rights basis', { exact: true }).selectOption('OWNED');
    await page.getByLabel('Evidence or license reference', { exact: true }).fill(importedStory.rights.evidence);
    await page.getByLabel('Territory', { exact: true }).fill('WORLDWIDE');
    await page.getByLabel('YouTube', { exact: true }).check();
    await page.getByLabel('Facebook', { exact: true }).check();
    await page.getByLabel('Commercial use is explicitly permitted.', { exact: true }).check();
    await page.getByLabel('I have checked the evidence and confirm this rights basis and permitted use for the post and its comments.', { exact: true }).check();
    await page.getByRole('button', { name: 'Record decision', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No pending material on this page', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Post library', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'approved owned' })).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByText('YouTube rights check: passed', { exact: true })).toBeVisible();
    await expect(page.getByText('Rights alone do not approve a video or enable publishing.', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Workspace settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspace members', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: email, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent audit events', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspace overview', exact: true })).toBeVisible();
    await expect(page.locator('.metric').filter({ hasText: 'Imported stories' }).locator('strong')).toHaveText('1');
    await expect(page.locator('.metric').filter({ hasText: 'Awaiting rights review' }).locator('strong')).toHaveText('0');
    await expect(page.getByText('blocked external', { exact: true })).toBeVisible();
    await expect(page.getByText(storyTitle, { exact: true })).toBeVisible();
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/dashboard.png', fullPage: true });

    await page.getByRole('link', { name: 'Workspace settings', exact: true }).click();
    await page.getByLabel('Workspace name', { exact: true }).fill(otherName);
    await page.getByLabel('Workspace slug', { exact: true }).fill(`isolated-qa-${runId}`);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue(/.+/);
    await expect(page.locator('.detail-list dd').filter({ hasText: otherName })).toBeVisible();
    const secondSession: { activeWorkspaceId: string } = await (await page.request.get('/api/v1/auth/me')).json();
    workspaceIds.push(secondSession.activeWorkspaceId);
    expect(secondSession.activeWorkspaceId).not.toBe(firstSession.activeWorkspaceId);
    await page.getByRole('link', { name: 'Post library', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your library is ready', exact: true })).toBeVisible();
    await expect(page.getByText(storyTitle, { exact: true })).toHaveCount(0);

    await page.getByLabel('Workspace', { exact: true }).selectOption(firstSession.activeWorkspaceId);
    await expect(page.getByRole('cell', { name: storyTitle })).toBeVisible();
    savedSession = await page.context().storageState();
  });

  test('mobile dashboard stays usable without horizontal overflow', async ({ browser, baseURL }) => {
    expect(savedSession).toBeDefined();
    const mobile = await browser.newContext({ baseURL, storageState: savedSession, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const page = await mobile.newPage();
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Workspace overview', exact: true })).toBeVisible();
      await expect(page.getByText(storyTitle, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      await expect(page.getByLabel('Workspace', { exact: true })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      await page.screenshot({ path: 'docs/screenshots/mobile-dashboard.png', fullPage: true });
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    } finally { await mobile.close(); }
  });
});
