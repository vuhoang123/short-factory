import { defineConfig } from '@playwright/test';
import localExport from './playwright-local-export.config';

export default defineConfig({
  ...localExport,
  testMatch: ['ui-stability.spec.ts', 'ui-layout.spec.ts', 'phase5-ui.spec.ts', 'local-export-ui.spec.ts', 'product-studio.spec.ts'],
  outputDir: '../../test-results/ui-browser',
});
