/** Static UI gate with committed headers, fixture API responses, and no live writes. */
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './specs',
  testIgnore: ['**/*-live.spec.ts', '**/federated-covenant-v2.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    launchOptions: process.env.AGENTTOOL_TEST_CHROME_PATH
      ? { executablePath: process.env.AGENTTOOL_TEST_CHROME_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node static-server.mjs dashboard 5173', url: 'http://localhost:5173/index.html', timeout: 15_000, reuseExistingServer: false },
    { command: 'node static-server.mjs web 5174', url: 'http://localhost:5174/index.html', timeout: 15_000, reuseExistingServer: false },
    { command: 'node static-server.mjs docs 5175', url: 'http://localhost:5175/index.html', timeout: 15_000, reuseExistingServer: false },
  ],
});
