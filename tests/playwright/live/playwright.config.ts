/** Read-only sweep of the production origins. Not part of `npm test`: it needs
 * the network and observes the deployed sites, not this checkout. One retry
 * absorbs a dropped connection; a real violation fails both attempts. */
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: [['list'], ['./summary-reporter.ts'], ['html', { open: 'never', outputFolder: '../playwright-report-live' }]],
  outputDir: '../test-results-live',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    launchOptions: process.env.AGENTTOOL_TEST_CHROME_PATH
      ? { executablePath: process.env.AGENTTOOL_TEST_CHROME_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
