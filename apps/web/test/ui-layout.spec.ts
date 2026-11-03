import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mockWorkspace } from './fixtures/workspace';

const routes = ['/dashboard', '/discover', '/studio', '/studio?mode=import', '/export', '/publish', '/channels', '/sources', '/library/posts', '/reviews', '/autopilot', '/analytics', '/settings', '/guide', '/login'];

for (const width of [320, 768, 1440]) {
  test(`all screens keep content and controls inside their layout at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await mockWorkspace(page);
    const failures: string[] = [];
    await mkdir('../../test-results/ui-layout', { recursive: true });
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      await page.waitForLoadState('networkidle');
      for (const summary of await page.locator('main details:not([open]) > summary').all()) if (await summary.isVisible()) await summary.click();
      const issues = await page.evaluate(() => {
        const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('details:not([open]) > :not(summary)');
        const excluded = '.table-scroll, .preview-stage, .studio-remotion-preview, .sidebar nav, nextjs-portal';
        const controls = [...document.querySelectorAll('main button, main a.button, main input:not([type="hidden"]), main select, main textarea, main summary, .secondary-navigation a, .secondary-navigation button, .secondary-navigation summary')].filter(element => visible(element) && !element.closest('.sidebar nav[aria-label="Main navigation"], .table-scroll, .preview-stage, .studio-remotion-preview, nextjs-portal'));
        const issues: string[] = [];
        for (const help of document.querySelectorAll('main .field-help')) {
          const previous = help.previousElementSibling;
          if (!visible(help) || !previous || !visible(previous) || !previous.matches('label, .studio-form-row')) continue;
          const overlap = previous.getBoundingClientRect().bottom - help.getBoundingClientRect().top;
          if (overlap > 1) issues.push(`help text overlaps ${previous.tagName} by ${overlap.toFixed(1)}px`);
        }
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
          issues.push('page has horizontal overflow');
          issues.push(...[...document.querySelectorAll('main *')].filter(element => visible(element) && !element.closest(excluded) && element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5).map(element => `outside: ${element.tagName}.${element.className}`));
        }
        for (const element of controls) {
          const rect = element.getBoundingClientRect();
          if (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1) issues.push(`overflow: ${element.textContent?.trim().slice(0, 70) || element.getAttribute('name') || element.tagName}`);
        }
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i]!, b = controls[j]!;
          if (a.contains(b) || b.contains(a)) continue;
          const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
          if (Math.min(r.right, s.right) - Math.max(r.left, s.left) > 2 && Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top) > 2) issues.push(`overlap: ${a.tagName} ${a.textContent?.trim().slice(0, 35)} / ${b.tagName} ${b.textContent?.trim().slice(0, 35)}`);
        }
        const brand = document.querySelector('.sidebar > .brand')?.getBoundingClientRect();
        const picker = document.querySelector('.workspace-picker')?.getBoundingClientRect();
        if (brand && picker && Math.min(brand.right, picker.right) - Math.max(brand.left, picker.left) > 2 && Math.min(brand.bottom, picker.bottom) - Math.max(brand.top, picker.top) > 2) issues.push('workspace picker overlaps the brand');
        return issues;
      });
      failures.push(...issues.map(issue => `${route}: ${issue}`));
      await page.screenshot({ path: `../../test-results/ui-layout/${width}-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-/, '')}.png`, fullPage: true });
    }
    expect(failures).toEqual([]);
  });
}

test('import starts with the source input and gives instructions room to breathe', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { mutations } = await mockWorkspace(page);
  await page.goto('/studio?mode=import');
  const input = page.getByRole('textbox', { name: 'Link để chụp ảnh gốc', exact: true });
  await expect(input).toBeVisible();
  const inputBox = (await input.boundingBox())!;
  expect(inputBox.y + inputBox.height).toBeLessThan(900);
  await expect(page.getByRole('heading', { name: 'Lịch sử tạo video', exact: true })).toHaveCount(0);
  const spacing = await page.locator('.source-capture-panel').evaluate(element => {
    const heading = element.querySelector('h2')!.getBoundingClientRect();
    const paragraph = element.querySelector('p')!.getBoundingClientRect();
    const label = element.querySelector('label')!.getBoundingClientRect();
    return { heading: paragraph.top - heading.bottom, label: label.top - paragraph.bottom };
  });
  expect(spacing.heading).toBeGreaterThanOrEqual(12);
  expect(spacing.label).toBeGreaterThanOrEqual(12);
  await page.getByText('Hoặc nhập văn bản thủ công', { exact: true }).click();
  await expect(page.getByLabel('Nội dung bài', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/studio?mode=import');
  await expect(input).toBeVisible();
  const mobileInputBox = (await input.boundingBox())!;
  expect(mobileInputBox.y + mobileInputBox.height).toBeLessThan(900);
  await mkdir('../../test-results/ui-layout', { recursive: true });
  await page.screenshot({ path: '../../test-results/ui-layout/import-mobile-ready.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '../../test-results/ui-layout/import-desktop-ready.png' });
  expect(mutations).toEqual([]);
});
