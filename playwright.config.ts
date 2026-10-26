import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('.env')) process.loadEnvFile('.env');

const baseURL = 'http://localhost:3002';
const environment = {
  ...process.env,
  APP_URL: baseURL,
  API_URL: 'http://127.0.0.1:3003',
  API_HOST: '127.0.0.1',
  API_PORT: '3003',
  NODE_ENV: 'development',
  ALLOW_REGISTRATION: 'true',
};

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } }],
  webServer: [
    {
      command: 'pnpm --filter @shorts-factory/api start',
      url: 'http://127.0.0.1:3003/api/v1/health',
      env: environment,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @shorts-factory/web exec next dev --hostname 127.0.0.1 --port 3002',
      url: `${baseURL}/health`,
      env: environment,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
