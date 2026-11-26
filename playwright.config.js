import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'https://localhost:5173',
    channel: 'chrome',
    headless: false,
    ignoreHTTPSErrors: true,
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--disable-quic',
        '--disable-http2',
        '--disable-features=AsyncDns',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
    storageState: 'tests/.auth/admin.json',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 25_000,
    navigationTimeout: 35_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
