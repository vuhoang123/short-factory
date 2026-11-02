import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (process.platform === 'win32'
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
  : undefined);

export default defineConfig({
  testDir: './test', testMatch: 'local-export-ui.spec.ts', outputDir: '../../test-results/local-export-browser',
  fullyParallel: false, workers: 1, retries: 0, timeout: 90_000, expect: { timeout: 20_000 }, reporter: [['list']],
  use: { baseURL: process.env.LOCAL_EXPORT_UI_BASE_URL ?? 'http://127.0.0.1:3006', actionTimeout: 15_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 }, launchOptions: { executablePath: browserExecutable } } }],
  webServer: process.env.LOCAL_EXPORT_UI_BASE_URL ? undefined : {
    command: 'node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3006', cwd: '.',
    url: 'http://127.0.0.1:3006/health', reuseExistingServer: false, timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
