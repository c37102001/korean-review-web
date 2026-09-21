import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/app',
  outputDir: 'test-results/app',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4176/korean-review-web/',
    browserName: 'chromium',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'VITE_APP_TEST_EMULATORS=1 npm run dev -- --host 127.0.0.1 --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176/korean-review-web/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
