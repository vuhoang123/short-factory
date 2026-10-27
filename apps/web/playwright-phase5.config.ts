import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: 'phase5-ui.spec.ts',
  outputDir: '../../test-results/phase5-browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3005', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } }],
  webServer: { command: process.env.PHASE5_UI_USE_BUILD === 'true' ? 'pnpm --filter @shorts-factory/web exec next start --hostname 127.0.0.1 --port 3005' : 'pnpm --filter @shorts-factory/web exec next dev --webpack --hostname 127.0.0.1 --port 3005', cwd: '../..', url: 'http://127.0.0.1:3005/health', reuseExistingServer: false, timeout: 120_000 },
});
