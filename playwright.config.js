import { defineConfig } from '@playwright/test';

import { readFileSync } from 'node:fs';

const { snapshotEnvironment } = JSON.parse(readFileSync(new URL('./tests/visual/environment.json', import.meta.url), 'utf8'));

export default defineConfig({
  testDir: './tests/visual',
  outputDir: 'test-results/visual',
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'line',
  snapshotPathTemplate: `{testDir}/{testFilePath}-snapshots/{arg}-${snapshotEnvironment}{ext}`,
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL: 'http://127.0.0.1:4175/korean-review-web/',
    browserName: 'chromium',
    colorScheme: 'light',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175/korean-review-web/visual-fixtures.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
