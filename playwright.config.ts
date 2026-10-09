import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  workers: process.env.FRONTIER_E2E_WORKERS === '2' ? 2 : 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
