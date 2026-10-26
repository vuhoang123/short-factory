import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'workers/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/*.integration.test.ts', '**/*.e2e.test.ts'],
    testTimeout: 15_000,
    fileParallelism: false
  }
});
